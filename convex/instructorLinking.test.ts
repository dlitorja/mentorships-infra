/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Smoke tests for the instructor-to-Clerk-user linking reconciliation fixes.
 *
 * Two distinct bug classes were addressed:
 *
 *   1. The `linkClerkUserToInstructor` action used to silently swallow
 *      the refusal result when an instructor was already bound to a
 *      different Clerk userId (`convex/http.ts:1207` dropped the return
 *      value). Now the refusal writes an `auditLogs` row with
 *      `action: "instructor_linking_refused"` so admins can find it
 *      via `listAuditLogs`.
 *
 *   2. The instructor students page would just see "Instructor profile
 *      not found" 404 when the caller was actually a victim of the
 *      silent-drop above. The new public query
 *      `getInstructorLinkingStatusForCurrentUser` exposes three
 *      discriminators (`linked`, `needs_reconciliation`,
 *      `no_instructor`) so the UI can render an actionable message
 *      with the existing Clerk userId the instructor should sign in
 *      with instead.
 *
 * Together these give an admin a search path (`auditLogs`) and the
 * instructor a self-service diagnostic (`needs_reconciliation`).
 */

const EMAIL = "rakasa.art+recon@example.com";
const OLD_CLERK_USER = "user_oldClerk1234567890";
const NEW_CLERK_USER = "user_newClerk0987654321";

async function seedExistingInstructor(
  ctx: any,
  opts: { userId?: string; email?: string } = {}
): Promise<string> {
  return await ctx.db.insert("instructors", {
    userId: opts.userId ?? OLD_CLERK_USER,
    name: "Rakasa",
    slug: "rakasa",
    email: (opts.email ?? EMAIL).toLowerCase(),
    isActive: true,
    isNew: false,
    maxActiveStudents: 10,
    oneOnOneInventory: 0,
    groupInventory: 0,
  });
}

test("getInstructorLinkingStatusForCurrentUser: returns `needs_reconciliation` when an unrelated placeholder row shadows a valid Clerk-linked row (Greptile P1 round 2)", async () => {
  // Greptile P1 round 2 ("First Email Match Wins"): the previous
  // implementation used `by_email.first()` and rejected any row whose
  // userId was a placeholder (`admin-${slug}`, `seed-${slug}`). When
  // the `by_email` index returned the placeholder row first, the
  // query gave up with `no_instructor` even though a separate row
  // with the same email was correctly Clerk-linked to a different
  // Clerk user. The new implementation collects ALL matching rows
  // (index + case-insensitive fallback) and walks them looking for
  // the first one whose userId is a real Clerk ID and differs from
  // the caller's subject.
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    // Placeholder row (admin-created, not yet linked). Goes first
    // because `_id` is monotonically increasing.
    await ctx.db.insert("instructors", {
      userId: "admin-rakasa",
      name: "Rakasa",
      slug: "rakasa",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: true,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    // Real Clerk-linked row with a DIFFERENT Clerk userId, same email.
    const linkedInstructorId = await ctx.db.insert("instructors", {
      userId: OLD_CLERK_USER,
      name: "Rakasa",
      slug: "rakasa-2",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    // Sanity check the test setup — the linked row must actually
    // exist so the query can return it.
    return { linkedInstructorId };
  });

  const client = t.withIdentity({
    subject: NEW_CLERK_USER,
    email: EMAIL,
  });

  const result = await client.query(
    api.instructors.getInstructorLinkingStatusForCurrentUser,
    {},
  );
  expect(result).toMatchObject({
    status: "needs_reconciliation",
    email: EMAIL.toLowerCase(),
    existingClerkUserId: OLD_CLERK_USER,
  });
});

test("createInstructorInternal: lowercases the email on insert (Greptile P2 round 2)", async () => {
  // Greptile P2 round 2 ("Fallback Scan Can Miss"): write paths
  // must normalize the `email` field so the `by_email` index lookup
  // is reliable. `createInstructorInternal` is the canonical
  // instructor insert path used by the Clerk webhook + auto-create
  // flow. This guards against future regressions where a caller
  // passes a mixed-case email and the row lands unnormalized.
  const t = convexTest(schema, modules);
  const instructorId = await t.mutation(
    internal.instructors.createInstructorInternal,
    {
      userId: NEW_CLERK_USER,
      name: "Rakasa",
      email: "Mixed.Case+Tag@Example.COM",
      isActive: true,
      isNew: true,
    },
  );
  const stored = await t.run(async (ctx) => ctx.db.get(instructorId));
  expect(stored?.email).toBe("mixed.case+tag@example.com");
});

test("normalizeAllInstructorEmails: lowercases every mixed-case email and reports counts (Greptile P2 round 2)", async () => {
  // Greptile P2 round 2 also flagged that legacy mixed-case rows
  // remain until a one-off migration runs. The mutation is committed
  // to the repo so it can be applied via
  // `npx convex run --prod internal.instructors.normalizeAllInstructorEmails`
  // after this PR merges. Here we verify the mutation correctly
  // identifies, lowercases, and reports counts for a mix of states.
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    // 1. Mixed case → should be lowercased.
    await ctx.db.insert("instructors", {
      userId: OLD_CLERK_USER,
      name: "MixedCase",
      slug: "mixed-case",
      email: "Mixed.Case@Example.com",
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    // 2. Already lowercased → no-op.
    await ctx.db.insert("instructors", {
      userId: "user_otherClerk123456789",
      name: "AlreadyLower",
      slug: "already-lower",
      email: "already.lower@example.com",
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    // 3. Missing email (legacy placeholder import) → cleared count.
    await ctx.db.insert("instructors", {
      userId: "user_missingEmail00000000",
      name: "NoEmail",
      slug: "no-email",
      email: undefined,
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
  });

  const result = await t.mutation(
    internal.instructors.normalizeAllInstructorEmails,
    {},
  );
  expect(result).toMatchObject({
    scanned: 3,
    updated: 1,
    alreadyNormalized: 1,
    cleared: 1,
  });

  // The mixed-case row must now be lowercased.
  const mixed = await t.run(async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", "mixed-case"))
      .first();
  });
  expect(mixed?.email).toBe("mixed.case@example.com");

  // Re-running is a no-op.
  const second = await t.mutation(
    internal.instructors.normalizeAllInstructorEmails,
    {},
  );
  expect(second).toMatchObject({
    scanned: 3,
    updated: 0,
    alreadyNormalized: 2,
    cleared: 1,
  });
});

test("getInstructorLinkingStatusForCurrentUser: returns `linked` when userId matches", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await t.run(async (ctx) => {
    return await seedExistingInstructor(ctx, { userId: OLD_CLERK_USER });
  });

  const client = t.withIdentity({
    subject: OLD_CLERK_USER,
    email: EMAIL,
  });

  const result = await client.query(
    api.instructors.getInstructorLinkingStatusForCurrentUser,
    {}
  );
  expect(result).toMatchObject({
    status: "linked",
    instructorId,
  });
});

test("getInstructorLinkingStatusForCurrentUser: returns `needs_reconciliation` when userId mismatches but email matches", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await t.run(async (ctx) => {
    return await seedExistingInstructor(ctx, { userId: OLD_CLERK_USER });
  });

  // Caller is the NEW Clerk account: same email as the instructor record,
  // different Clerk subject. Without the new query, `getInstructorByUserId`
  // would return null and the caller would see a bare 404.
  const client = t.withIdentity({
    subject: NEW_CLERK_USER,
    email: EMAIL,
  });

  const result = await client.query(
    api.instructors.getInstructorLinkingStatusForCurrentUser,
    {}
  );
  expect(result).toMatchObject({
    status: "needs_reconciliation",
    instructorId,
    email: EMAIL.toLowerCase(),
    existingClerkUserId: OLD_CLERK_USER,
  });
});

test("getInstructorLinkingStatusForCurrentUser: returns `no_instructor` when neither userId nor email matches", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedExistingInstructor(ctx, {
      userId: OLD_CLERK_USER,
      email: "someone-else@example.com",
    });
  });

  const client = t.withIdentity({
    subject: "user_unrelated000000000000",
    email: "totally-different@example.com",
  });

  const result = await client.query(
    api.instructors.getInstructorLinkingStatusForCurrentUser,
    {}
  );
  expect(result).toMatchObject({ status: "no_instructor" });
});

test("getInstructorLinkingStatusForCurrentUser: returns `no_instructor` when email matches but existing userId is a placeholder (not Clerk-shaped)", async () => {
  // Placeholder userIds (`admin-${slug}`, `seed-${slug}`) are NOT
  // treated as reconciliation candidates — they should be overwritten
  // by the linking flow, not flagged for admin review.
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("instructors", {
      userId: "admin-rakasa",
      name: "Rakasa",
      slug: "rakasa",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: true,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
  });

  const client = t.withIdentity({
    subject: NEW_CLERK_USER,
    email: EMAIL,
  });

  const result = await client.query(
    api.instructors.getInstructorLinkingStatusForCurrentUser,
    {}
  );
  expect(result).toMatchObject({ status: "no_instructor" });
});

test("getInstructorLinkingStatusForCurrentUser: returns `no_instructor` when caller has no email on the Clerk identity", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedExistingInstructor(ctx, { userId: OLD_CLERK_USER });
  });

  const client = t.withIdentity({
    subject: NEW_CLERK_USER,
    // no email field — Clerk sessions may omit it
  });

  const result = await client.query(
    api.instructors.getInstructorLinkingStatusForCurrentUser,
    {}
  );
  expect(result).toMatchObject({ status: "no_instructor" });
});

test("getInstructorLinkingStatusForCurrentUser: returns `needs_reconciliation` for legacy mixed-case email storage (Greptile P1)", async () => {
  // `createInstructorInternal` and the admin `updateInstructor`
  // mutation store emails verbatim, so an instructor row written
  // through those paths may carry mixed-case email text. The
  // indexed `by_email` lookup is exact-match on the lowercased
  // Clerk email, so it would miss such rows. The query has a
  // case-insensitive JS fallback (`.take(N)` then JS compare) so
  // legacy rows still surface the actionable
  // `needs_reconciliation` state.
  const t = convexTest(schema, modules);
  const instructorId = await t.run(async (ctx) => {
    return await ctx.db.insert("instructors", {
      userId: OLD_CLERK_USER,
      name: "Rakasa",
      slug: "rakasa",
      email: "Rakasa.Art+Recon@Example.com", // mixed case, no whitespace
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
  });

  const client = t.withIdentity({
    subject: NEW_CLERK_USER,
    email: "rakasa.art+recon@example.com",
  });

  const result = await client.query(
    api.instructors.getInstructorLinkingStatusForCurrentUser,
    {}
  );
  expect(result).toMatchObject({
    status: "needs_reconciliation",
    instructorId,
    email: "rakasa.art+recon@example.com",
    existingClerkUserId: OLD_CLERK_USER,
  });
});

test("linkClerkUserToInstructor: refusal writes an auditLogs row with `instructor_linking_refused` action", async () => {
  // Regression test for the silent-drop bug: the action used to return
  // `{ linked: false, reason: "Instructor already linked to a different Clerk user" }`
  // and the caller at `convex/http.ts:1207` ignored it. Now we record
  // an audit row so admins can find these via `listAuditLogs({ action:
  // "instructor_linking_refused" })`.
  const t = convexTest(schema, modules);
  const instructorId = await t.run(async (ctx) => {
    return await seedExistingInstructor(ctx, { userId: OLD_CLERK_USER });
  });

  const result = await t.action(
    internal.instructors.linkClerkUserToInstructor,
    {
      userId: NEW_CLERK_USER,
      email: EMAIL,
    }
  );
  expect(result.instructorLinking).toMatchObject({
    linked: false,
    reason: "Instructor already linked to a different Clerk user",
    instructorId,
  });

  // The instructor record's userId must NOT be mutated (anti-hijack).
  const after = await t.run(async (ctx) => {
    return await ctx.db.get(instructorId as string);
  });
  expect(after?.userId).toBe(OLD_CLERK_USER);

  // The audit row must exist with both Clerk userIds + the fix hint.
  const audits = await t.run(async (ctx) => {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_action", (q) => q.eq("action", "instructor_linking_refused"))
      .collect();
  });
  expect(audits).toHaveLength(1);
  expect(audits[0]?.targetType).toBe("instructor");
  expect(audits[0]?.targetId).toBe(instructorId);
  expect(audits[0]?.metadata).toMatchObject({
    email: EMAIL.toLowerCase(),
    existingClerkUserId: OLD_CLERK_USER,
    newClerkUserId: NEW_CLERK_USER,
  });
  expect(String(audits[0]?.details)).toContain(OLD_CLERK_USER);
  expect(String(audits[0]?.details)).toContain(NEW_CLERK_USER);
});

test("linkClerkUserToInstructor: dedup does not add a second audit row on retry with the same Clerk userIds (Greptile P2)", async () => {
  // Clerk webhooks retry on transient failure. Without dedup, the
  // `instructor_linking_refused` action would append one identical
  // row per retry, polluting the admin audit search. The action
  // checks via `internal.auditLog.hasMatchingAuditLog` before
  // writing — first call inserts, second call short-circuits.
  const t = convexTest(schema, modules);
  const instructorId = await t.run(async (ctx) => {
    return await seedExistingInstructor(ctx, { userId: OLD_CLERK_USER });
  });

  // First call: writes the audit row.
  await t.action(internal.instructors.linkClerkUserToInstructor, {
    userId: NEW_CLERK_USER,
    email: EMAIL,
  });
  // Second call with the same args: must NOT add a duplicate row.
  await t.action(internal.instructors.linkClerkUserToInstructor, {
    userId: NEW_CLERK_USER,
    email: EMAIL,
  });

  const audits = await t.run(async (ctx) => {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_action", (q) => q.eq("action", "instructor_linking_refused"))
      .collect();
  });
  expect(audits).toHaveLength(1);

  // A retry with a DIFFERENT newClerkUserId still writes a row,
  // because the dedup key is (existingClerkUserId, newClerkUserId).
  const OTHER_NEW_CLERK_USER = "user_thirdClerk999999999";
  await t.action(internal.instructors.linkClerkUserToInstructor, {
    userId: OTHER_NEW_CLERK_USER,
    email: EMAIL,
  });
  const auditsAfter = await t.run(async (ctx) => {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_action", (q) => q.eq("action", "instructor_linking_refused"))
      .collect();
  });
  expect(auditsAfter).toHaveLength(2);
  const clerkUserIds = auditsAfter
    .map((a) => (a.metadata as Record<string, unknown>)?.newClerkUserId)
    .sort();
  expect(clerkUserIds).toEqual([NEW_CLERK_USER, OTHER_NEW_CLERK_USER].sort());
});

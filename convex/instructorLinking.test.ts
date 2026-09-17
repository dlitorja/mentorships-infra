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

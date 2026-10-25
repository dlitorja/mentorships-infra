/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Smoke tests for the bearer-auth HTTP endpoints added in
 * `chore/secret-removal-low-risk`. Each endpoint:
 *   - Returns 401 without the bearer header
 *   - Returns 401 with a wrong bearer
 *   - Returns 200 with a valid bearer
 *   - Writes an audit log atomically with the data write (where
 *     applicable)
 *
 * The endpoints we test are:
 *   - POST /instructors/create-for-clerk-user
 *   - POST /instructors/deactivate-by-user-id
 *   - POST /users/set-role
 *   - POST /users/set-clerk-id
 *   - POST /users/sync-clerk-profile
 */

function bearerHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

async function setupAdmin(t: ReturnType<typeof convexTest>) {
  const adminUserId = "user_admin_1";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });
  return adminUserId;
}

const VALID_KEY = "test-http-key";

test("http endpoints: 401 without Authorization header", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r1 = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user_x" }),
  });
  expect(r1.status).toBe(401);

  const r2 = await t.fetch("/users/set-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user_x", role: "instructor" }),
  });
  expect(r2.status).toBe(401);
});

test("http endpoints: 401 with wrong bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/instructors/deactivate-by-user-id", {
    method: "POST",
    headers: bearerHeaders("wrong-key"),
    body: JSON.stringify({ userId: "user_x" }),
  });
  expect(r.status).toBe(401);
});

test("http /users/sync-clerk-profile: updates linked and split rows", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_student_profile",
      clerkId: "user_student_profile",
      email: "old@example.com",
      firstName: "Old",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: "email:old@example.com",
      clerkId: "placeholder_split",
      email: "old@example.com",
      firstName: "Old",
      role: "student",
      onboardingAlias: "split-profile",
    });
  });

  const response = await t.fetch("/users/sync-clerk-profile", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      clerkUserId: "user_student_profile",
      email: "NEW@example.com",
      firstName: "Updated",
      lastName: "Student",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ updatedCount: 2 });

  const users = await t.run(async (ctx) => await ctx.db.query("users").collect());
  expect(users).toHaveLength(2);
  expect(users).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        email: "new@example.com",
        firstName: "Updated",
        lastName: "Student",
      }),
      expect.objectContaining({
        email: "new@example.com",
        firstName: "Updated",
        lastName: "Student",
        onboardingAlias: "split-profile",
      }),
    ])
  );
});

test("http /users/sync-clerk-profile: clears removed names", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_clear_name",
      clerkId: "user_clear_name",
      email: "clear@example.com",
      firstName: "Remove",
      lastName: "Me",
      role: "student",
    });
  });

  const response = await t.fetch("/users/sync-clerk-profile", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      clerkUserId: "user_clear_name",
      email: "clear@example.com",
      firstName: null,
      lastName: null,
    }),
  });
  expect(response.status).toBe(200);

  const user = await t.run(async (ctx) =>
    ctx.db.query("users").withIndex("by_userId", (q) => q.eq("userId", "user_clear_name")).first()
  );
  expect(user?.firstName).toBeUndefined();
  expect(user?.lastName).toBeUndefined();
});

test("http endpoints: 200 with valid bearer, body shape correct", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_target",
      email: "target@example.com",
      clerkId: "user_target",
      role: "student",
    });
  });

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_target",
      name: "Alex Target",
      email: "target@example.com",
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body).toMatchObject({ success: true });
  expect(body.instructorId).toBeDefined();
});

test("http /instructors/create-for-clerk-user: writes audit row atomically", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_audit_target",
      email: "audit@example.com",
      clerkId: "user_audit_target",
      role: "student",
    });
  });

  const before = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(before.length).toBe(0);

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_audit_target", name: "Audit" }),
  });
  expect(r.status).toBe(200);

  const after = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(after.length).toBeGreaterThan(0);
  expect(after[0].action).toBe("create_instructor_for_clerk_user");
});

test("http /instructors/create-for-clerk-user: links existing placeholder instructor by email", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  const placeholderId = await t.run(async (ctx) => {
    return await ctx.db.insert("instructors", {
      userId: "admin-test-instructor",
      slug: "test-instructor",
      name: "Test Instructor",
      email: "placeholder-instructor@example.com",
      isActive: true,
      isNew: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_real_clerk",
      email: "placeholder-instructor@example.com",
      clerkId: "user_real_clerk",
      role: "student",
    });
  });

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_real_clerk",
      email: "placeholder-instructor@example.com",
      name: "Test Instructor",
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body).toMatchObject({ success: true, reason: "Linked existing instructor" });
  expect(body.instructorId).toBe(placeholderId);

  const updated = await t.run(async (ctx) => {
    return await ctx.db.get(placeholderId as Id<"instructors">);
  });
  expect(updated?.userId).toBe("user_real_clerk");
});

test("http /instructors/create-for-clerk-user: links invited instructor by instructorId even when email is ambiguous", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  const [invitedId, otherId] = await t.run(async (ctx) => {
    const email = "duplicate@example.com";
    const invited = await ctx.db.insert("instructors", {
      userId: "admin-invited",
      slug: "invited-instructor",
      name: "Invited Instructor",
      email,
      isActive: true,
      isNew: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const other = await ctx.db.insert("instructors", {
      userId: "admin-other",
      slug: "other-instructor",
      name: "Other Instructor",
      email,
      isActive: true,
      isNew: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    return [invited as Id<"instructors">, other as Id<"instructors">];
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_real_clerk",
      email: "duplicate@example.com",
      clerkId: "user_real_clerk",
      role: "student",
    });
  });

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_real_clerk",
      email: "duplicate@example.com",
      name: "Invited Instructor",
      instructorId: invitedId,
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body).toMatchObject({ success: true, reason: "Linked invited instructor" });
  expect(body.instructorId).toBe(invitedId);

  const invitedRecord = await t.run(async (ctx) => {
    return await ctx.db.get(invitedId);
  });
  const otherRecord = await t.run(async (ctx) => {
    return await ctx.db.get(otherId);
  });
  expect(invitedRecord?.userId).toBe("user_real_clerk");
  expect(otherRecord?.userId).toBe("admin-other");
});

test("http /instructors/deactivate-by-user-id: writes audit row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_deact",
      email: "deact@example.com",
      clerkId: "user_deact",
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: "user_deact",
      slug: "deact-slug",
      name: "Deact",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
  });

  const r = await t.fetch("/instructors/deactivate-by-user-id", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_deact" }),
  });
  expect(r.status).toBe(200);

  const instructor = await t.run(async (ctx) => {
    return await ctx.db.query("instructors").first();
  });
  expect(instructor?.isActive).toBe(false);

  const logs = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(logs.some((l: any) => l.action === "deactivate_instructor_by_user_id")).toBe(true);
});

test("http /users/set-role: writes audit row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_role",
      email: "role@example.com",
      clerkId: "user_role",
      role: "student",
    });
  });

  const r = await t.fetch("/users/set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_role", role: "instructor" }),
  });
  expect(r.status).toBe(200);

  const user = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_role"))
      .first();
  });
  expect(user?.role).toBe("instructor");

  const logs = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(logs.some((l: any) => l.action === "set_user_role_http")).toBe(true);
});

test("http /users/set-clerk-id: updates user", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_clerk",
      email: "clerk@example.com",
      clerkId: "old-clerk",
      role: "student",
    });
  });

  const r = await t.fetch("/users/set-clerk-id", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_clerk", clerkId: "new-clerk" }),
  });
  expect(r.status).toBe(200);

  const user = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_clerk"))
      .first();
  });
  expect(user?.clerkId).toBe("new-clerk");
});

test("http /users/set-role: invalid role returns 400", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/users/set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_x", role: "god" }),
  });
  expect(r.status).toBe(400);
});

/**
 * Greptile P1 security (PR fix/instructor-role-claim-in-clerk, eighth
 * pass follow-up): `/users/set-role` is intentionally UNCONDITIONAL.
 * Marketing's `AuthDrivenInvalidator` syncs admin -> student demotions
 * through this endpoint; if the elevated-preservation guard were on
 * THIS endpoint, demoting an admin in Clerk would silently leave their
 * Convex admin role intact. The guard was moved to
 * `/users/ops-set-role` (see below). This test is the regression check
 * for that split.
 */
test("http /users/set-role: marketing demotion path (admin -> student) is NOT 409", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const adminUserId = "user_market_demote";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "marketing@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  const r = await t.fetch("/users/set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: adminUserId, role: "student" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.role).toBe("student");
});

/**
 * Greptile P1 (PR fix/instructor-role-claim-in-clerk, follow-up):
 * the legacy repair script (`apps/platform/scripts/claim-instructor-role.mts`)
 * uses `/users/ops-set-role` (added in this PR). Refuses to overwrite
 * an existing elevated role; allows elevated -> elevated same-role
 * writes through.
 *
 * The split deliberately separates the auth-sync flow
 * (`/users/set-role`, unconditional) from the legacy repair flow
 * (`/users/ops-set-role`, conservative). Adding the elevated-
 * preservation guard to `/users/set-role` would have broken the
 * marketing demotion path (Greptile P1 follow-up).
 */
test("http /users/ops-set-role: refuses to overwrite an existing elevated role (409 + preserved)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const adminUserId = "user_admin_ops_preserve";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin-ops@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: adminUserId, role: "instructor" }),
  });
  expect(r.status).toBe(409);
  const body = await r.json();
  expect(body.preserved).toBe(true);
  expect(body.currentRole).toBe("admin");
  expect(body.requestedRole).toBe("instructor");

  const stillAdmin = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", adminUserId))
      .first()
  );
  expect(stillAdmin?.role).toBe("admin");
});

test("http /users/ops-set-role: writes a student -> instructor (the legacy repair path)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_ops_repair",
      email: "ops@example.com",
      clerkId: "user_ops_repair",
      role: "student",
    });
  });

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_ops_repair", role: "instructor" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.role).toBe("instructor");

  const logs = await t.run(async (ctx) =>
    ctx.db.query("auditLogs").collect()
  );
  expect(logs.some((l: any) => l.action === "ops_repair_set_role")).toBe(true);
});

test("http /users/ops-set-role: rejects non-Clerk-shaped userId with 400", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "admin-rakasa", role: "instructor" }),
  });
  expect(r.status).toBe(400);
  const body = await r.json();
  expect(body.error).toMatch(/must start with "user_"/);
});

test("http /users/ops-set-role: rejects admin elevation (defense against accidental self-promotion)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_new_admin", role: "admin" }),
  });
  expect(r.status).toBe(400);
  const body = await r.json();
  expect(body.error).toMatch(/role is required and must be one of/);
});

test("http /users/ops-set-role: allows elevated-to-elevated same-role writes (no false-positive 409)", async () => {
  // Setting admin -> admin on the ops endpoint should NOT 409.
  // Only demotions are refused.
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const adminUserId = "user_ops_admin_same";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin-same@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  // admin -> video_editor is elevated-to-elevated, allowed.
  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: adminUserId, role: "video_editor" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.role).toBe("video_editor");
});

/**
 * Greptile P1 (ninth pass, follow-up): drive the underlying mutation
 * directly to lock in the elevated-preservation behavior. The
 * `enforceElevatedPreservation: true` flag was added so the check
 * happens INSIDE the same `db.patch` transaction (closing the
 * TOCTOU window the previous runQuery + runMutation shape had).
 */
test("convex.users.setUserRoleTrusted: enforceElevatedPreservation throws ELEVATED_ROLE_PRESERVED for demotion", async () => {
  const t = convexTest(schema, modules);

  const adminUserId = "user_setrole_internal_admin";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "setrole-admin@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  await expect(
    t.run(async (ctx) =>
      ctx.runMutation(internal.users.setUserRoleTrusted, {
        userId: adminUserId,
        role: "instructor",
        enforceElevatedPreservation: true,
      })
    ),
  ).rejects.toThrow(/^ELEVATED_ROLE_PRESERVED:/);

  // Confirm the role is untouched (preserved).
  const stillAdmin = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", adminUserId))
      .first()
  );
  expect(stillAdmin?.role).toBe("admin");
});

test("convex.users.setUserRoleTrusted: enforceElevatedPreservation absent preserves pre-PP semantics (admin -> student succeeds)", async () => {
  // Backward-compat regression: callers that DON'T pass
  // enforceElevatedPreservation behave exactly as before, including
  // allowing elevated demotions. Specifically `/users/set-role` and
  // the auth-sync flow depend on this. If we accidentally tightened
  // the default, marketing's AuthDrivenInvalidator would break again.
  const t = convexTest(schema, modules);

  const adminUserId = "user_setrole_compat_admin";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "compat-admin@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  await t.run(async (ctx) =>
    ctx.runMutation(internal.users.setUserRoleTrusted, {
      userId: adminUserId,
      // NO enforceElevatedPreservation flag -- preserved pre-PP behavior.
      role: "student",
    })
  );

  const after = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", adminUserId))
      .first()
  );
  expect(after?.role).toBe("student");
});

/**
 * Greptile P1 (tenth pass, follow-up): `users.email` is v.string() in
 * the schema, so the insert path requires an email. When the ops
 * endpoint receives a userId with no prior Convex presence AND no
 * `email` in the body, the mutation throws MISSING_EMAIL_REQUIRED
 * which the httpAction translates to a 400 with the explicit
 * guidance below. The ops script supplies email from the Clerk user
 * lookup, so this rejection is a defensive sanity check on the
 * endpoint contract, not a regression path.
 */
test("http /users/ops-set-role: missing-email insert path returns 400 (no prior users row + no email)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_no_prior_record",
      role: "instructor",
    }),
  });
  expect(r.status).toBe(400);
  const body = await r.json();
  expect(body.code).toBe("missing-email");
  expect(body.error).toMatch(/users\.email is required/);
});

test("http /users/ops-set-role: missing-email insert path SUCCEEDS when email is supplied (Greptile P1 tenth pass happy path)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_no_prior_record_with_email",
      role: "instructor",
      email: "fresh@example.com",
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.role).toBe("instructor");

  const stored = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_no_prior_record_with_email"),
      )
      .first()
  );
  expect(stored?.email).toBe("fresh@example.com");
});

/**
 * Greptile P1 (sixteenth pass): when an email is supplied in mixed
 * case or with whitespace (typical Clerk return shapes, esp. before
 * the user logs in for the first time), the insert path must
 * normalize via trim().toLowerCase() so the next `syncUser` -- which
 * canonicalizes its lookup key the same way -- does not miss the
 * row and create a duplicate `users` record.
 */
test("http /users/ops-set-role: supplied email is normalized to trim+lowercase before insert", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_unnormalized_email",
      role: "instructor",
      email: "  Teacher@Example.COM  ",
    }),
  });
  expect(r.status).toBe(200);

  const stored = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_unnormalized_email"))
      .first()
  );
  // Stored email should be the canonical form -- trimmed + lowered.
  expect(stored?.email).toBe("teacher@example.com");
});

test("http /users/ops-set-role: rejects email of non-string type with 400", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_abc",
      role: "instructor",
      email: 42,
    }),
  });
  expect(r.status).toBe(400);
  const body = await r.json();
  expect(body.error).toMatch(/email, if provided, must be a string/);
});

/**
 * Greptile P1 (twenty-first pass): when a legacy users row
 * already exists with the same normalized email but a different
 * (userId, clerkId), the insert path must refuse to create a
 * competing row. The HTTP layer translates the tagged mutation
 * error to 409 `code: "email-belongs-to-another"` with both
 * attempted and existing identities so the operator can decide
 * whether to merge, re-link, or leave for manual reconciliation.
 */
test("http /users/ops-set-role: 409 on email-already-owned-by-another-user (Greptile P1 twenty-first pass)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  // Seed a legacy student row with a different userId but the
  // email we will try to claim for a different user.
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_legacy_owns_email",
      email: "shared@example.com",
      clerkId: "user_legacy_owns_email",
      role: "student",
    });
  });

  const r = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_instructor_trying_email",
      role: "instructor",
      email: "  Shared@Example.COM  ", // unnormalized -- mutation normalizes
    }),
  });
  expect(r.status).toBe(409);
  const body = await r.json();
  expect(body.code).toBe("email-belongs-to-another");
  expect(body.attempted.userId).toBe("user_instructor_trying_email");
  expect(body.attempted.email).toBe("shared@example.com");
  expect(body.existing.userId).toBe("user_legacy_owns_email");
  expect(body.existing.role).toBe("student");

  // Confirm the legacy row was NOT modified and no new row exists
  // for the attempted userId.
  const inserted = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_instructor_trying_email"),
      )
      .collect()
  );
  expect(inserted.length).toBe(0);
});

test("http /users/ops-set-role: email guard does NOT trigger when same user re-replays insert", async () => {
  // The guard fires only when a different (userId, clerkId) row
  // exists. If the same userId is replaying the write (e.g. a
  // retry after the network blip), the guard is a no-op: the
  // existing row IS the same user. The path falls through to the
  // ds.patch branch and works.
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  // First call: insert.
  const r1 = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_idempotent_email_check",
      role: "instructor",
      email: "  Someone@Example.COM  ",
    }),
  });
  expect(r1.status).toBe(200);

  // Second call (same user): the lookup finds this userId in the
  // rows, so `conflictingOther` is undefined and the guard does
  // not fire. Operations land in the patch path -> 200.
  const r2 = await t.fetch("/users/ops-set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_idempotent_email_check",
      role: "instructor",
      email: "someone@example.com",
    }),
  });
  expect(r2.status).toBe(200);
});

/**
 * Greptile P1 (eleventh pass, follow-up): linked-account repair.
 * For a migrated/legacy user the by_userId row keyed on a different
 * id exists alongside a clerkId-linked lookup; the previous
 * by_userId-only lookup would INSERT a competing row. With the
 * by_clerkId fallback, we PATCH the existing row's userId and role
 * instead of duplicating the account. Doubly important for
 * elevated: an admin-linked-by-clerkId row must not be demoted in
 * favor of a fresh instructor row.
 */
test("convex.users.setUserRoleTrusted: patches an existing clerkId-linked row instead of inserting a competing row", async () => {
  const t = convexTest(schema, modules);

  const oldUserId = "user_legacy_linked_userid";
  const newClerkId = "user_modern_clerk_id";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: oldUserId,
      email: "linked@example.com",
      clerkId: newClerkId, // userId != clerkId — linked-account shape
      role: "student",
    });
  });

  // BEFORE: only the legacy row exists. by_userId(newClerkId) is
  // empty. by_clerkId(newClerkId) finds the legacy row.
  const before = await t.run(async (ctx) => {
    const byUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", newClerkId))
      .first();
    const byClerk = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", newClerkId))
      .first();
    return { byUser, byClerk };
  });
  expect(before.byUser).toBeNull();
  expect(before.byClerk?.userId).toBe(oldUserId);

  await t.run(async (ctx) =>
    ctx.runMutation(internal.users.setUserRoleTrusted, {
      userId: newClerkId,
      role: "instructor",
      enforceElevatedPreservation: true,
    })
  );

  // AFTER: the legacy row was patched. by_clerkId(newClerkId) still
  // resolves to the same row (no competing row inserted). The
  // legacy primary account ID (the old userId) is preserved --
  // changing it needs a separate explicit migration (Greptile P1
  // twelfth pass). The old userId is the row's primary-account
  // identity; rebinding it to the Clerk id would orphan the row at
  // the original primary id and any downstream by_userId("A")
  // lookups would 403.
  const afterByClerk = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", newClerkId))
      .first()
  );
  expect(afterByClerk).not.toBeNull();
  expect(afterByClerk?.role).toBe("instructor");
  // Primary account ID preserved (was oldUserId; stays oldUserId).
  expect(afterByClerk?.userId).toBe(oldUserId);
  expect(afterByClerk?.clerkId).toBe(newClerkId);

  // Confirm by_userId at the OLD primary id still finds the row.
  const afterByOldUserId = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", oldUserId))
      .first()
  );
  expect(afterByOldUserId?.role).toBe("instructor");

  // No competing row was inserted at by_userId(newClerkId) --
  // that index still returns null.
  const newRow = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", newClerkId))
      .first()
  );
  expect(newRow).toBeNull();
});

test("convex.users.setUserRoleTrusted: clerkId-linked admin row is preserved (no demotion via linked lookup)", async () => {
  // Greptile P1 (eleventh pass) specific elevated case: a linked
  // admin row exists. Before the by_clerkId fallback, the by_userId
  // miss would have inserted a new instructor row, splitting the
  // identity. After the fallback, the existing elevated row is
  // PATCHED but elevate-preservation still refuses to demote it.
  const t = convexTest(schema, modules);

  const oldUserId = "user_legacy_admin_userid";
  const newClerkId = "user_modern_admin_clerk_id";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: oldUserId,
      email: "linkedadmin@example.com",
      clerkId: newClerkId,
      role: "admin",
    });
  });

  await expect(
    t.run(async (ctx) =>
      ctx.runMutation(internal.users.setUserRoleTrusted, {
        userId: newClerkId,
        role: "instructor",
        enforceElevatedPreservation: true,
      })
    ),
  ).rejects.toThrow(/^ELEVATED_ROLE_PRESERVED:/);

  const after = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", oldUserId))
      .first()
  );
  expect(after?.role).toBe("admin");

  const newLinked = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", newClerkId))
      .first()
  );
  expect(newLinked).toBeNull(); // no competing row inserted
});

test("http /instructors/create-for-clerk-user: missing userId returns 400", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ name: "NoUser" }),
  });
  expect(r.status).toBe(400);
});

test("http /instructors/create-for-clerk-user: enforceElevatedPreservation opt-in preserves admin (Greptile P1 fifteenth pass)", async () => {
  // Pre-seed an admin whose Clerk role has been demoted to
  // "instructor"; this is the self-heal path that
  // apps/platform/app/api/instructor/sync-role/route.ts drives.
  // Without preservation, an admin would be silently demoted when
  // the JWT-derived instructor claim is reconciled. With the
  // opt-in flag set, the helper preserves admin and the action
  // returns the preserved:true shape.
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const adminUserId = "user_sync_role_admin";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "sync-admin@example.com",
      clerkId: adminUserId,
      role: "admin", // existing elevated role
    });
  });

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: adminUserId,
      email: "sync-admin@example.com",
      enforceElevatedPreservation: true,
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.success).toBe(true);

  // The instructor row should exist (the action's first job).
  const instructors = await t.run(async (ctx) =>
    ctx.db.query("instructors").collect()
  );
  expect(instructors.length).toBeGreaterThanOrEqual(1);

  // Convex users.role should STILL be admin -- preserved.
  const after = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", adminUserId))
      .first()
  );
  expect(after?.role).toBe("admin");
});

test("http /instructors/create-for-clerk-user: default (no enforceElevatedPreservation) honors Clerk demotion for webhook flow (Greptile P1 fifteenth pass)", async () => {
  // For a webhook-driven caller (Inngest lifecycle, Clerk webhook
  // handler) the absence of the flag is the explicit-removal
  // semantic: an admin's Clerk role was demoted, propagate the
  // demotion to Convex users.role.
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const adminUserId = "user_webhook_admin_to_instructor";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "webhook-admin@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: adminUserId,
      email: "webhook-admin@example.com",
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.success).toBe(true);

  // Convex users.role SHOULD be demoted to instructor -- the
  // webhook event respected the Clerk-side demotion.
  const after = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", adminUserId))
      .first()
  );
  expect(after?.role).toBe("instructor");
});

test("http /instructors/create-for-clerk-user: rejects non-boolean enforceElevatedPreservation", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_abc",
      enforceElevatedPreservation: "true", // string, not boolean
    }),
  });
  expect(r.status).toBe(400);
  const body = await r.json();
  expect(body.error).toMatch(/enforceElevatedPreservation/);
});

/**
 * PR B: bearer-auth HTTP endpoints for the admin-onboarding flow.
 * Each endpoint:
 *   - Returns 401 without the bearer header
 *   - Returns 200 with a valid bearer (happy path body shape)
 *
 * The endpoints we test are:
 *   - POST /admin-onboarding/get
 *   - POST /admin-onboarding/list
 *   - POST /admin-onboarding/instructor-contacts
 *   - POST /admin-onboarding/stale
 *   - POST /admin-onboarding/append-timeline
 *   - POST /admin-onboarding/mark-email-sent
 *   - POST /admin-onboarding/release-placeholder
 *   - POST /admin-onboarding/release-placeholder-batch
 */

async function seedAdminOnboardingRow(
  t: ReturnType<typeof convexTest>,
  email: string,
  status: "queued" | "processing" | "completed" | "failed" | "cancelled" = "processing",
  attemptCount = 1,
): Promise<{ onboardingId: string; instructorId: string }> {
  let onboardingId = "";
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      name: "Test Instructor",
      slug: "test-instructor",
      email: "instructor@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    onboardingId = await ctx.db.insert("adminOnboardings", {
      email,
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status,
      attemptCount,
      perInstructor: [
        {
          instructorId: instructorId as any,
          isRenewal: false,
          sessionsPerInstructor: 4,
        },
      ],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      timeline: [
        { at: Date.now(), event: "queued" },
      ],
      createdAt: Date.now(),
    });
  });
  return { onboardingId, instructorId };
}

test("http /admin-onboarding/get: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-test-1@example.com");

  const r = await t.fetch("/admin-onboarding/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: onboardingId }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/get: 200 returns the row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-test-2@example.com");

  const r = await t.fetch("/admin-onboarding/get", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ id: onboardingId }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body?.email).toBe("aob-test-2@example.com");
});

test("http /admin-onboarding/list: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-list-1@example.com");

  const r = await t.fetch("/admin-onboarding/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/list: 200 returns the rows", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-list-2@example.com");

  const r = await t.fetch("/admin-onboarding/list", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ status: "processing" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(Array.isArray(body.rows)).toBe(true);
  expect(body.rows.some((row: any) => row.email === "aob-list-2@example.com")).toBe(true);
});

test("http /admin-onboarding/list: 400 on invalid status value", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-list-bad@example.com");

  const r = await t.fetch("/admin-onboarding/list", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ status: "not_a_real_status" }),
  });
  expect(r.status).toBe(400);
});

test("http /admin-onboarding/instructor-contacts: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { instructorId } = await seedAdminOnboardingRow(t, "aob-ic-1@example.com");

  const r = await t.fetch("/admin-onboarding/instructor-contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructorIds: [instructorId] }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/instructor-contacts: 200 returns contact map", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { instructorId } = await seedAdminOnboardingRow(t, "aob-ic-2@example.com");

  const r = await t.fetch("/admin-onboarding/instructor-contacts", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ instructorIds: [instructorId] }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  // Greptile finding (PR B): the endpoint returns the contact map
  // directly, NOT wrapped in `{ contacts: ... }`, so consumers can index
  // by instructorId without an extra property hop.
  expect(body[instructorId]).toBeDefined();
  expect(body[instructorId].email).toBe("instructor@example.com");
  expect(body[instructorId].name).toBe("Test Instructor");
});

test("http /admin-onboarding/stale: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-stale-1@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/stale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cutoffMs: Date.now(), paginationOpts: { numItems: 10 } }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/stale: 200 returns page", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-stale-2@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/stale", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ cutoffMs: Date.now(), paginationOpts: { numItems: 10 } }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(Array.isArray(body.rows)).toBe(true);
});

test("http /admin-onboarding/append-timeline: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-append-1@example.com");

  const r = await t.fetch("/admin-onboarding/append-timeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingId, event: "processing_started" }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/append-timeline: 200 appends entry", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-append-2@example.com");

  const r = await t.fetch("/admin-onboarding/append-timeline", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ onboardingId, event: "processing_started" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.event).toBe("processing_started");

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.timeline.some((e: any) => e.event === "processing_started")).toBe(true);
});

test("http /admin-onboarding/mark-email-sent: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-mail-1@example.com");

  const r = await t.fetch("/admin-onboarding/mark-email-sent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      onboardingId,
      recipient: { kind: "student" },
    }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/mark-email-sent: 200 appends email_sent entry", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-mail-2@example.com");

  const r = await t.fetch("/admin-onboarding/mark-email-sent", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      onboardingId,
      recipient: { kind: "student" },
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.event).toBe("email_sent");

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.timeline.some((e: any) => e.event === "email_sent")).toBe(true);
});

test("http /admin-onboarding/release-placeholder: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-rel-1@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingId }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/release-placeholder: 200 appends released entry", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-rel-2@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ onboardingId, details: "test-release" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.releasedCount).toBeDefined();
  expect(body.skipped).toBeDefined();

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.timeline.some((e: any) => e.event === "released")).toBe(true);
});

test("http /admin-onboarding/release-placeholder-batch: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-batch-1@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingIds: [onboardingId] }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/release-placeholder-batch: 200 returns aggregate counters", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const a = await seedAdminOnboardingRow(t, "aob-batch-2a@example.com", "completed");
  const b = await seedAdminOnboardingRow(t, "aob-batch-2b@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder-batch", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      onboardingIds: [a.onboardingId, b.onboardingId],
      details: "test-batch-release",
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.onboardingsProcessed).toBeDefined();
  expect(Array.isArray(body.failedOnboardingIds)).toBe(true);
});

/**
 * Security sweep F1: `users.createUser` is internal-only, and the only
 * remote path to it is this bearer-gated endpoint. These tests pin the
 * gate: no row is written without the shared secret.
 */
test("http /users/create: 401 without Authorization header and with a wrong bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const body = JSON.stringify({
    userId: "email:guest-401@example.com",
    email: "guest-401@example.com",
    role: "student",
  });

  const noAuth = await t.fetch("/users/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  expect(noAuth.status).toBe(401);

  const wrongAuth = await t.fetch("/users/create", {
    method: "POST",
    headers: bearerHeaders("definitely-not-the-key"),
    body,
  });
  expect(wrongAuth.status).toBe(401);

  const rows = await t.run(
    async (ctx) => await ctx.db.query("users").collect()
  );
  expect(rows).toHaveLength(0);
});

test("http /users/create: creates a student placeholder and is idempotent by email", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const body = JSON.stringify({
    userId: "email:guest-200@example.com",
    email: "guest-200@example.com",
    role: "student",
  });

  const first = await t.fetch("/users/create", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body,
  });
  expect(first.status).toBe(200);

  const second = await t.fetch("/users/create", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body,
  });
  expect(second.status).toBe(200);

  const rows = await t.run(
    async (ctx) => await ctx.db.query("users").collect()
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].email).toBe("guest-200@example.com");
  expect(rows[0].role).toBe("student");
  expect(rows[0].clerkId).toBe("placeholder_email:guest-200@example.com");

  expect(await first.json()).toEqual(await second.json());
});

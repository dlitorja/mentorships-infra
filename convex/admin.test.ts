/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ---------------------------------------------------------------------------
// getMyRole
//
// Authoritative role check consumed by the apps/web, apps/marketing, and
// apps/platform `requireRoleForApi("admin")` helpers (Convex-wins pattern).
// The query returns `{ role }` from the `users` table keyed by
// `identity.subject` via the `by_userId` and `by_clerkId` indexes.
// ---------------------------------------------------------------------------

test("getMyRole: returns { role: null } when caller has no identity", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_a",
      clerkId: "user_a",
      email: "a@example.com",
      role: "admin",
    });
  });
  const result = await t.query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: null });
});

test("getMyRole: returns 'admin' when users.role is 'admin' (byUserId match)", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_admin_role";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: "admin-role@example.com",
      role: "admin",
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: "admin" });
});

test("getMyRole: returns 'student' when users.role is 'student'", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_student_role";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: "student-role@example.com",
      role: "student",
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: "student" });
});

test("getMyRole: returns 'instructor' when users.role is 'instructor'", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_instructor_role";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: "instructor-role@example.com",
      role: "instructor",
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: "instructor" });
});

test("getMyRole: returns null when role is unset (legacy record)", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_unset_role";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: "unset-role@example.com",
      // role intentionally omitted — matches the legacy path
      // `convex/migrations.ts:backfillNotificationPreferences` documents.
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: null });
});

test("getMyRole: falls back to by_clerkId index when by_userId misses", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_clerk_only";
  await t.run(async (ctx) => {
    // userId differs from identity.subject; only clerkId matches.
    await ctx.db.insert("users", {
      userId: "user_some_other",
      clerkId: subject,
      email: "clerk-only@example.com",
      role: "admin",
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: "admin" });
});

test("getMyRole: linked admin row beats non-admin primary row (admin on by_clerkId wins)", async () => {
  // Greptile R2 P1: a user can have two `users` rows — a primary
  // (e.g. student) keyed by `userId`, plus an admin-linked row keyed
  // by `clerkId`. Mirror `isAdminUser`'s precedence: admin on
  // EITHER index is treated as admin.
  const t = convexTest(schema, modules);
  const subject = "user_linked_admin";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: "user_some_other",
      email: "primary@example.com",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: "user_some_other",
      clerkId: subject,
      email: "linked@example.com",
      role: "admin",
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: "admin" });
});

test("getMyRole: admin on by_userId wins even when by_clerkId row has a non-admin role", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_primary_admin";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: "primary@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: "user_some_other",
      clerkId: subject,
      email: "linked@example.com",
      role: "student",
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: "admin" });
});

test("getMyRole: returns { role: null } when no users row matches either index", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_unknown";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_a",
      clerkId: "user_a",
      email: "a@example.com",
      role: "admin",
    });
  });
  const result = await t.withIdentity({ subject }).query(api.admin.getMyRole, {});
  expect(result).toEqual({ role: null });
});

// ---------------------------------------------------------------------------
// updateUserRole
//
// Greptile P1 #1 (PR #904): demoting via `updateUserRole` must also patch
// any linked `users` row matched by `by_clerkId`. Otherwise a demoted
// admin could keep admin access via the linked row.
// ---------------------------------------------------------------------------

test("updateUserRole: patches the primary by_userId row", async () => {
  const t = convexTest(schema, modules);
  const adminSubject = "user_admin_actor";
  const targetSubject = "user_admin_target";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminSubject,
      clerkId: adminSubject,
      email: "actor@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: targetSubject,
      clerkId: targetSubject,
      email: "target@example.com",
      role: "admin",
    });
  });
  await t
    .withIdentity({ subject: adminSubject })
    .mutation(api.users.updateUserRole, { userId: targetSubject, role: "student" });

  const result = await t
    .withIdentity({ subject: targetSubject })
    .query(api.admin.getMyRole, {});
  expect(result.role).toBe("student");
});

test("updateUserRole: demoting also patches a linked by_clerkId admin row (P1 #1)", async () => {
  // The target has TWO `users` rows: a primary (keyed by userId) plus a
  // linked admin row keyed by clerkId. Demoting must patch BOTH rows,
  // otherwise the linked row keeps admin access via `getMyRole`.
  const t = convexTest(schema, modules);
  const adminSubject = "user_admin_actor_2";
  const targetSubject = "user_linked_admin_target";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminSubject,
      clerkId: adminSubject,
      email: "actor2@example.com",
      role: "admin",
    });
    // Primary row: userId === subject, role=admin.
    await ctx.db.insert("users", {
      userId: targetSubject,
      clerkId: targetSubject,
      email: "primary@example.com",
      role: "admin",
    });
    // Linked row: userId = something else, clerkId === subject, role=admin.
    await ctx.db.insert("users", {
      userId: "user_some_other_target",
      clerkId: targetSubject,
      email: "linked@example.com",
      role: "admin",
    });
  });

  await t
    .withIdentity({ subject: adminSubject })
    .mutation(api.users.updateUserRole, { userId: targetSubject, role: "student" });

  // The primary row is now student.
  const primaryAfter = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", targetSubject))
      .first();
    return row?.role;
  });
  expect(primaryAfter).toBe("student");

  // The linked row is now student too — the demotion is consistent.
  const linkedAfter = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", targetSubject))
      .first();
    return row?.role;
  });
  expect(linkedAfter).toBe("student");

  // And getMyRole reflects the demotion.
  const result = await t
    .withIdentity({ subject: targetSubject })
    .query(api.admin.getMyRole, {});
  expect(result.role).toBe("student");
});

test("updateUserRole: refuses when caller is not admin", async () => {
  const t = convexTest(schema, modules);
  const studentSubject = "user_student_actor";
  const targetSubject = "user_some_target";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentSubject,
      clerkId: studentSubject,
      email: "student-actor@example.com",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: targetSubject,
      clerkId: targetSubject,
      email: "target@example.com",
      role: "student",
    });
  });
  await expect(
    t
      .withIdentity({ subject: studentSubject })
      .mutation(api.users.updateUserRole, { userId: targetSubject, role: "admin" })
  ).rejects.toThrow(/Admin access required/);
});

// ---------------------------------------------------------------------------
// bootstrapAdminRoleOnce
//
// Greptile P1 #2 (PR #904): atomic first-time admin bootstrap. Single
// Convex transaction doing precondition + insert + audit. Replaces the
// multi-call dance (fetchQuery → syncUser → /users/set-role) that had
// a race window.
//
// Greptile P2 #3: existing row is rejected even when its role is unset.
// ---------------------------------------------------------------------------

test("bootstrapAdminRoleOnce: inserts a new admin row when no users row exists", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_first_time_admin";
  const result = await t.mutation(internal.users.bootstrapAdminRoleOnce, {
    userId: subject,
    actorId: subject,
  });
  expect(result.role).toBe("admin");
  expect(result.userId).toBe(subject);
  expect(result.clerkId).toBe(subject);

  const fetched = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", subject))
      .first();
  });
  expect(fetched?.role).toBe("admin");
});

test("bootstrapAdminRoleOnce: refuses when a by_userId row already exists", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_existing_student";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: "existing@example.com",
      role: "student",
    });
  });
  await expect(
    t.mutation(internal.users.bootstrapAdminRoleOnce, {
      userId: subject,
      actorId: subject,
    })
  ).rejects.toThrow(/Refusing bootstrap/);
});

test("bootstrapAdminRoleOnce: refuses when a by_clerkId row already exists (linked-account attempt)", async () => {
  // Greptile P2 #3: a row exists by clerkId (different userId) but no
  // role. The bootstrap must still reject — first-time means no row at
  // all, not "no role set".
  const t = convexTest(schema, modules);
  const subject = "user_clerk_only_target";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_some_other_id",
      clerkId: subject,
      email: "linked-existing@example.com",
      // role intentionally unset
    });
  });
  await expect(
    t.mutation(internal.users.bootstrapAdminRoleOnce, {
      userId: subject,
      actorId: subject,
    })
  ).rejects.toThrow(/Refusing bootstrap/);
});

test("bootstrapAdminRoleOnce: writes an audit log row", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_audit_target";
  await t.mutation(internal.users.bootstrapAdminRoleOnce, {
    userId: subject,
    actorId: subject,
  });
  const audits = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(audits).toHaveLength(1);
  expect(audits[0].action).toBe("bootstrap_admin_role");
  expect(audits[0].targetType).toBe("user");
  expect(audits[0].targetId).toBe(subject);
});

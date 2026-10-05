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

test("updateUserRole: linked-row lookup uses args.userId, not target.clerkId (P1 #8)", async () => {
  // Greptile P1 #8: the linked-row patch must look up by the Clerk
  // user ID of the target (which is `args.userId` in normal
  // operation), not by `targetUser.clerkId`. If `targetUser.clerkId`
  // is stale or points at a different account, patching by it would
  // demote the wrong user. Seed an unrelated row whose clerkId would
  // be a false match for the old (buggy) lookup, and verify it is
  // NOT patched.
  const t = convexTest(schema, modules);
  const adminSubject = "user_admin_actor_3";
  const targetSubject = "user_target_with_wrong_clerkId";
  const otherClerkAccount = "user_some_other_clerk_account";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminSubject,
      clerkId: adminSubject,
      email: "actor3@example.com",
      role: "admin",
    });
    // Target row: userId === subject, but clerkId is set to an
    // unrelated account (the stale-link case). This is the buggy
    // setup: if the old code looked up by `targetUser.clerkId`, it
    // would find the otherClerkAccount row and demote it.
    await ctx.db.insert("users", {
      userId: targetSubject,
      clerkId: otherClerkAccount,
      email: "target-wrong@example.com",
      role: "admin",
    });
    // The unrelated row that the buggy lookup would have hit.
    await ctx.db.insert("users", {
      userId: otherClerkAccount,
      clerkId: otherClerkAccount,
      email: "other@example.com",
      role: "admin",
    });
  });

  await t
    .withIdentity({ subject: adminSubject })
    .mutation(api.users.updateUserRole, { userId: targetSubject, role: "student" });

  // Target row is now student.
  const targetAfter = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", targetSubject))
      .first();
    return row?.role;
  });
  expect(targetAfter).toBe("student");

  // The unrelated account's row is NOT demoted.
  const otherAfter = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", otherClerkAccount))
      .first();
    return row?.role;
  });
  expect(otherAfter).toBe("admin");
});

test("updateUserRole: patches ALL linked rows on the same clerkId, not just the first (P1 #9)", async () => {
  // Greptile P1 #9: the by_clerkId index can return multiple rows.
  // Using `.first()` only patches one. The fix uses `.collect()` and
  // patches every row except the target itself.
  const t = convexTest(schema, modules);
  const adminSubject = "user_admin_actor_4";
  const targetSubject = "user_target_with_many_links";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminSubject,
      clerkId: adminSubject,
      email: "actor4@example.com",
      role: "admin",
    });
    // Primary row.
    await ctx.db.insert("users", {
      userId: targetSubject,
      clerkId: targetSubject,
      email: "primary4@example.com",
      role: "admin",
    });
    // Two linked rows with the same clerkId (admin + support overlay).
    await ctx.db.insert("users", {
      userId: "user_link_a",
      clerkId: targetSubject,
      email: "linkA@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: "user_link_b",
      clerkId: targetSubject,
      email: "linkB@example.com",
      role: "admin",
    });
  });

  await t
    .withIdentity({ subject: adminSubject })
    .mutation(api.users.updateUserRole, { userId: targetSubject, role: "student" });

  // All three rows (primary + 2 linked) must now be student.
  const rolesAfter = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", targetSubject))
      .collect();
    return rows.map((r) => r.role);
  });
  expect(rolesAfter).toEqual(["student", "student", "student"]);

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
  const email = "first-time-admin@example.com";
  const result = await t.mutation(internal.users.bootstrapAdminRoleOnce, {
    userId: subject,
    actorId: subject,
    email,
  });
  expect(result.role).toBe("admin");
  expect(result.userId).toBe(subject);
  expect(result.clerkId).toBe(subject);
  // Greptile P1 #7 (PR #904): the email must be persisted so the
  // subsequent Clerk-webhook `syncUser` (which looks up by `by_email`)
  // finds the row instead of inserting a duplicate.
  expect(result.email).toBe(email);

  const fetched = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", subject))
      .first();
  });
  expect(fetched?.role).toBe("admin");
  expect(fetched?.email).toBe(email);
});

test("bootstrapAdminRoleOnce: refuses when email is empty (P1 #10)", async () => {
  // Greptile P1 #10: an empty-email bootstrap row would be missed by
  // the later `syncUser` (which looks up by email) and produce a
  // duplicate row. The mutation now requires a non-empty email; the
  // HTTP route surfaces a 502 if it cannot resolve one.
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(internal.users.bootstrapAdminRoleOnce, {
      userId: "user_no_email_target",
      actorId: "user_no_email_target",
      email: "",
    })
  ).rejects.toThrow(/email is required/);
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
      email: "existing@example.com",
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
      email: "linked-existing@example.com",
    })
  ).rejects.toThrow(/Refusing bootstrap/);
});

test("bootstrapAdminRoleOnce: writes an audit log row", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_audit_target";
  await t.mutation(internal.users.bootstrapAdminRoleOnce, {
    userId: subject,
    actorId: subject,
    email: "audit@example.com",
  });
  const audits = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(audits).toHaveLength(1);
  expect(audits[0].action).toBe("bootstrap_admin_role");
  expect(audits[0].targetType).toBe("user");
  expect(audits[0].targetId).toBe(subject);
});

test("syncUser + bootstrapAdminRoleOnce: mixed-case Clerk email finds the bootstrap row (P1 #11)", async () => {
  // Greptile P1 #11 (PR #904 follow-up): if a new admin's Clerk
  // email contains uppercase letters, `bootstrapAdminRoleOnce`
  // stores it in lowercase, but `syncUser` previously looked up
  // by the original case. The later sync would miss the admin
  // row and insert a duplicate. Both paths now use lowercased
  // emails; this test proves that by actually running syncUser
  // (not just hand-rolling the lookup — Greptile P2 #1).
  const t = convexTest(schema, modules);
  const subject = "user_mixed_case_admin";
  const mixedCaseEmail = "Mixed.Case@Example.COM";
  const loweredEmail = mixedCaseEmail.toLowerCase();

  // Bootstrap first (admin-only path) — uses lowercase email.
  await t.mutation(internal.users.bootstrapAdminRoleOnce, {
    userId: subject,
    actorId: subject,
    email: mixedCaseEmail,
  });

  // Now run syncUser as the same Clerk identity, but with a
  // mixed-case email in identity.email (mirrors what Clerk
  // actually sends). syncUser must find the bootstrap row, not
  // insert a duplicate.
  await t
    .withIdentity({ subject, email: mixedCaseEmail })
    .mutation(api.users.syncUser, { firstName: "Mixed" });

  const rows = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", subject))
      .collect();
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("admin");
  expect(rows[0].email).toBe(loweredEmail);
  expect(rows[0].firstName).toBe("Mixed");
});

test("syncUser: refuses to merge when an existing row's clerkId differs (P1 #12 security)", async () => {
  // Greptile P1 #12 (PR #905, security): if a new Clerk account's
  // email normalizes to one already in the users table, syncUser
  // must NOT silently merge it onto the existing row. Otherwise
  // an attacker who creates a Clerk account with email
  // `Admin@Example.com` could inherit an existing admin row.
  // The mitigation refuses and surfaces the conflict.
  const t = convexTest(schema, modules);
  const adminSubject = "user_existing_admin";
  const adminEmail = "admin@example.com";
  const attackerSubject = "user_attacker_clerk";
  const attackerEmail = "Admin@Example.COM"; // normalizes to admin@example.com

  // Bootstrap an admin with a Clerk account that owns the email.
  await t.mutation(internal.users.bootstrapAdminRoleOnce, {
    userId: adminSubject,
    actorId: adminSubject,
    email: adminEmail,
  });

  // A different Clerk account (the attacker) tries to sync with
  // an email that normalizes to the admin's row. syncUser must
  // refuse, NOT overwrite the admin row's userId/clerkId.
  await expect(
    t
      .withIdentity({ subject: attackerSubject, email: attackerEmail })
      .mutation(api.users.syncUser, {})
  ).rejects.toThrow(/Refusing to link/i);

  // The admin row is unchanged.
  const adminRow = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", adminSubject))
      .first();
  });
  expect(adminRow?.clerkId).toBe(adminSubject);
  expect(adminRow?.role).toBe("admin");
});

test("syncUser: legacy mixed-case migrated row is still findable (P1 #13)", async () => {
  // Greptile P1 #13 (PR #905): rows written before normalization
  // (mixed-case `email`) must still be reachable from syncUser
  // so we don't duplicate them. syncUser falls back to a raw
  // by_email lookup when the normalized lookup misses.
  const t = convexTest(schema, modules);
  const subject = "user_legacy_migrated";
  const legacyEmail = "Legacy.User@Example.COM"; // raw, not lowercased

  // Seed a row directly with a mixed-case email (simulates the
  // pre-normalization state).
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      email: legacyEmail,
      clerkId: subject,
      role: "student",
    });
  });

  // syncUser with the same identity should find the legacy row,
  // NOT insert a new one. The resulting email stays as it was
  // (legacy data; we don't mutate it).
  await t
    .withIdentity({ subject, email: legacyEmail })
    .mutation(api.users.syncUser, {});

  const rows = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", subject))
      .collect();
  });
  expect(rows).toHaveLength(1);
});

test("getCurrentUser: returns the row for a mixed-case Clerk email (P1 #14)", async () => {
  // Greptile P1 #14 (PR #905): syncUser now writes emails in
  // lowercase. getCurrentUser must look up the lowercased form
  // or a new user with a mixed-case Clerk email would have an
  // empty dashboard (calendar can't find them).
  const t = convexTest(schema, modules);
  const subject = "user_calendar_mixed_case";
  const mixedCaseEmail = "Calendar.Mixed@Example.COM";

  await t
    .withIdentity({ subject, email: mixedCaseEmail })
    .mutation(api.users.syncUser, {});

  const got = await t
    .withIdentity({ subject, email: mixedCaseEmail })
    .query(api.users.getCurrentUser, {});
  expect(got).not.toBeNull();
  expect(got?.userId).toBe(subject);
});

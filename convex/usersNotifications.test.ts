/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import migrationsTest from "@convex-dev/migrations/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for `convex/users.ts:setNotificationPreference` and
 * `convex/migrations.ts:backfillNotificationPreferences`.
 *
 * The mutation is the user-facing toggle surface (PR #4) and the
 * migration backfills the default for existing students so the
 * recording-ready email pipeline (PR #2) works for them on day
 * one.
 */

type UserRole =
  | "student"
  | "instructor"
  | "admin"
  | "video_editor"
  | "support";

async function seedStudentUser(
  t: ReturnType<typeof convexTest>,
  overrides: {
    userId?: string;
    role?: UserRole;
    notificationPreferences?: unknown;
  } = {}
): Promise<string> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      userId: overrides.userId ?? "user_student_pr4",
      email: "student-pr4@example.com",
      clerkId: "clerk_student_pr4",
      role: overrides.role ?? "student",
      notificationPreferences: overrides.notificationPreferences,
    });
  }).then((id) => id as string);
}

test("setNotificationPreference: unauthorized without identity", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t);

  await expect(
    t.mutation(api.users.setNotificationPreference, {
      key: "recordingReadyEmail",
      value: false,
    })
  ).rejects.toThrow(/Unauthorized/);
});

test("setNotificationPreference: unauthorized when no matching user row", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t);

  // The seed sets userId = "user_student_pr4" but the auth identity
  // subject below doesn't match it, so the user lookup returns null.
  await expect(
    t.withIdentity({ subject: "user_someone_else" }).mutation(
      api.users.setNotificationPreference,
      { key: "recordingReadyEmail", value: false }
    )
  ).rejects.toThrow(/Unauthorized/);
});

test("setNotificationPreference: rejects unknown preference key", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t);

  await expect(
    t
      .withIdentity({ subject: "user_student_pr4" })
      .mutation(api.users.setNotificationPreference, {
        key: "inAppBannerDismissed",
        value: true,
      })
  ).rejects.toThrow(/Unsupported notification preference key/);
});

test("setNotificationPreference: opt-out persists and returns merged blob", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, {
    notificationPreferences: {
      existingKey: "keep-me",
      recordingReadyEmail: true,
    },
  });

  const result = await t
    .withIdentity({ subject: "user_student_pr4" })
    .mutation(api.users.setNotificationPreference, {
      key: "recordingReadyEmail",
      value: false,
    });

  expect(result.ok).toBe(true);
  expect(result.notificationPreferences).toMatchObject({
    existingKey: "keep-me",
    recordingReadyEmail: false,
  });

  const stored = await t.run(async (ctx) => {
    return await ctx.db.query("users").first();
  });
  expect(stored?.notificationPreferences).toMatchObject({
    existingKey: "keep-me",
    recordingReadyEmail: false,
  });
});

test("setNotificationPreference: opt-in replaces missing blob with default", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, { notificationPreferences: undefined });

  const result = await t
    .withIdentity({ subject: "user_student_pr4" })
    .mutation(api.users.setNotificationPreference, {
      key: "recordingReadyEmail",
      value: true,
    });

  expect(result.notificationPreferences).toEqual({
    recordingReadyEmail: true,
  });
});

test("setNotificationPreference: tolerates malformed existing blob", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  // Arrays are technically typeof "object" — the merge logic must
  // not propagate an array. Expected: replace with { recordingReadyEmail: true }.
  await seedStudentUser(t, {
    notificationPreferences: ["nonsense", "array"],
  });

  const result = await t
    .withIdentity({ subject: "user_student_pr4" })
    .mutation(api.users.setNotificationPreference, {
      key: "recordingReadyEmail",
      value: false,
    });

  expect(result.notificationPreferences).toEqual({
    recordingReadyEmail: false,
  });
});

test("setNotificationPreference: cannot mutate another user's preferences", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, {
    userId: "user_target",
    notificationPreferences: { recordingReadyEmail: true },
  });

  // Authenticated as someone else — lookup fails → Unauthorized.
  await expect(
    t
      .withIdentity({ subject: "user_attacker" })
      .mutation(api.users.setNotificationPreference, {
        key: "recordingReadyEmail",
        value: false,
      })
  ).rejects.toThrow(/Unauthorized/);

  // The target's preference must be unchanged.
  const target = await t.run(async (ctx) => {
    return await ctx.db.query("users").first();
  });
  expect(target?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: stamps default true for students with no prefs", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, { notificationPreferences: undefined });

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_student_pr4_second",
      email: "student-pr4-second@example.com",
      clerkId: "clerk_student_pr4_second",
      role: "student",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const all = await t.run(async (ctx) => {
    return await ctx.db.query("users").collect();
  });
  for (const u of all) {
    expect(u.notificationPreferences).toMatchObject({
      recordingReadyEmail: true,
    });
  }
});

test("backfillNotificationPreferences: skips non-students", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, { notificationPreferences: undefined });
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_instructor_pr4",
      email: "instructor-pr4@example.com",
      clerkId: "clerk_instructor_pr4",
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: "user_admin_pr4",
      email: "admin-pr4@example.com",
      clerkId: "clerk_admin_pr4",
      role: "admin",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const instructor = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_instructor_pr4"))
      .first();
  });
  const admin = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_admin_pr4"))
      .first();
  });
  expect(instructor?.notificationPreferences).toBeUndefined();
  expect(admin?.notificationPreferences).toBeUndefined();
});

test("backfillNotificationPreferences: respects existing opt-out", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, {
    notificationPreferences: { recordingReadyEmail: false },
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db.query("users").first();
  });
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: false,
  });
});

test("backfillNotificationPreferences: overwrites malformed preference blob", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  // Boolean key set to a non-boolean value (e.g., a string). The
  // reader in `recordingReadyNotifications.ts` falls back to default
  // true for non-boolean values, so the migration should also
  // normalize this — leaving it as a string would be inconsistent.
  await seedStudentUser(t, {
    notificationPreferences: { recordingReadyEmail: "yes" },
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db.query("users").first();
  });
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: preserves other keys in existing blob", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, {
    notificationPreferences: {
      inAppBannerDismissed: true,
      anotherKey: 42,
    },
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db.query("users").first();
  });
  expect(stored?.notificationPreferences).toMatchObject({
    inAppBannerDismissed: true,
    anotherKey: 42,
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: is idempotent on re-run", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, { notificationPreferences: undefined });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});
  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db.query("users").first();
  });
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("setNotificationPreference: instructor authenticated as themselves is rejected", async () => {
  // Greptile R2 P2: gate both the UI AND the backend mutation
  // to students. Recording-ready emails only flow to students
  // (the email pipeline targets workspace owners), so writing
  // the preference for any other role would be dead data — a
  // working-looking switch with no downstream effect. Even an
  // instructor's own self-write is rejected.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_instructor_pr4",
      email: "instructor-pr4-self@example.com",
      clerkId: "clerk_instructor_pr4_self",
      role: "instructor",
    });
  });

  await expect(
    t
      .withIdentity({ subject: "user_instructor_pr4" })
      .mutation(api.users.setNotificationPreference, {
        key: "recordingReadyEmail",
        value: false,
      })
  ).rejects.toThrow(/Only students can save notification preferences/);

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_instructor_pr4"))
      .first();
  });
  expect(stored?.notificationPreferences).toBeUndefined();
});

test("setNotificationPreference: admin authenticated as themselves is rejected", async () => {
  // Same gate, different role. The mutation's role check runs
  // BEFORE the key whitelist, so the error message names the
  // role constraint rather than the key constraint.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_admin_pr4_self",
      email: "admin-pr4-self@example.com",
      clerkId: "clerk_admin_pr4_self",
      role: "admin",
    });
  });

  await expect(
    t
      .withIdentity({ subject: "user_admin_pr4_self" })
      .mutation(api.users.setNotificationPreference, {
        key: "recordingReadyEmail",
        value: false,
      })
  ).rejects.toThrow(/Only students can save notification preferences/);
});

test("setNotificationPreference: attacker who supplies a fabricated subject is rejected", async () => {
  // Defense in depth: even if a future caller tries to forge an
  // identity, the server-side `ctx.auth.getUserIdentity()` is the
  // source of truth. The test below proves that an identity
  // pointing at a non-existent userId fails closed.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, {
    userId: "user_real_target",
    notificationPreferences: { recordingReadyEmail: true },
  });

  await expect(
    t
      .withIdentity({ subject: "user_real_target" })
      .mutation(api.users.setNotificationPreference, {
        key: "recordingReadyEmail",
        value: false,
      })
  ).resolves.toMatchObject({ ok: true });

  // Now switch identity — even if it matched the real user's
  // userId at the call site, the next call is for a different
  // subject and should not find a matching row.
  await expect(
    t
      .withIdentity({ subject: "user_no_such_user" })
      .mutation(api.users.setNotificationPreference, {
        key: "recordingReadyEmail",
        value: false,
      })
  ).rejects.toThrow(/Unauthorized/);
});

test("setNotificationPreference: legacy user with undefined role is accepted (backfill-window safety net)", async () => {
  // Greptile R3 P1: `syncUser` can preserve an undefined Convex
  // role on legacy records, while the UI surfaces the toggle to
  // those users via Clerk-derived workspace role. Without a
  // safety net the mutation would block them from opting out.
  // This test proves the mutation accepts undefined-role users
  // (the migration will eventually stamp their role).
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_legacy_undefined",
      email: "legacy-undefined@example.com",
      clerkId: "clerk_legacy_undefined",
      // role intentionally undefined
    });
  });

  const result = await t
    .withIdentity({ subject: "user_legacy_undefined" })
    .mutation(api.users.setNotificationPreference, {
      key: "recordingReadyEmail",
      value: false,
    });

  expect(result.ok).toBe(true);

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_legacy_undefined")
      )
      .first();
  });
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: false,
  });
});

test("backfillNotificationPreferences: stamps role=student AND preference for legacy workspace-owner with undefined role", async () => {
  // Greptile R3 P1: legacy records can have `role === undefined`
  // AND own a workspace. Without this branch, the migration
  // skips them and the mutation would still be blocking them.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_legacy_workspace_owner",
      email: "legacy-owner@example.com",
      clerkId: "clerk_legacy_owner",
      // role intentionally undefined
    });
    // Seed a student-classifying workspace for this user. The
    // type filter (R4 P1) requires `mentorship` or `admin_student`
    // for ownership to count as proof of student-hood.
    await ctx.db.insert("workspaces", {
      name: "Legacy Workspace",
      ownerId: "user_legacy_workspace_owner",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_legacy_workspace_owner")
      )
      .first();
  });
  expect(stored?.role).toBe("student");
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: skips legacy user with undefined role who owns an admin_instructor workspace", async () => {
  // Greptile R4 P1: `admin_instructor` workspaces store an
  // administrator in `ownerId`, not a student. Treating any
  // ownership as proof of student-hood would silently promote
  // admins to `"student"` and shift their role-based
  // authorization and navigation. The migration must filter on
  // workspace type.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_admin_instructor_owner",
      email: "admin-instructor-owner@example.com",
      clerkId: "clerk_admin_instructor_owner",
      // role intentionally undefined — these are legacy records
      // too, just not the ones we want to promote.
    });
    await ctx.db.insert("workspaces", {
      name: "Admin Instructor Workspace",
      ownerId: "user_admin_instructor_owner",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_instructor",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_admin_instructor_owner")
      )
      .first();
  });
  expect(stored?.role).toBeUndefined();
  expect(stored?.notificationPreferences).toBeUndefined();
});

test("backfillNotificationPreferences: legacy user with undefined role who owns a student-classifying AND an instructor-classifying workspace is NOT promoted (instructor wins)", async () => {
  // Greptile R7 P1: when a legacy user owns multiple qualifying
  // workspaces, the previous `.first()` query picked whichever
  // workspace the index returned first — non-deterministic and
  // unsafe. The migration must aggregate across ALL qualifying
  // workspaces: if ANY qualifies as an instructor (linked-
  // instructor match), the user is treated as an instructor
  // (the more specific signal wins over "owner-as-student").
  //
  // Shape: two qualifying `mentorship` workspaces owned by the
  // same user. Workspace A has NO `instructorId` (classifies
  // owner as student). Workspace B has an `instructorId` that
  // matches the same user (classifies them as instructor).
  // Aggregated: instructor wins → NOT promoted.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_owner_and_instructor",
      email: "owner-and-instructor@example.com",
    });
    await ctx.db.insert("users", {
      userId: "user_owner_and_instructor",
      email: "owner-and-instructor@example.com",
      clerkId: "clerk_owner_and_instructor",
      // role intentionally undefined
    });
    // Workspace A: student-classifying (no instructorId).
    await ctx.db.insert("workspaces", {
      name: "Mentorship Without Linked Instructor",
      ownerId: "user_owner_and_instructor",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    // Workspace B: instructor-classifying (same user is
    // linked instructor).
    await ctx.db.insert("workspaces", {
      name: "Mentorship Where Same User Is Linked Instructor",
      ownerId: "user_owner_and_instructor",
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_owner_and_instructor")
      )
      .first();
  });
  expect(stored?.role).toBeUndefined();
  expect(stored?.notificationPreferences).toBeUndefined();
});

test("backfillNotificationPreferences: legacy user with undefined role who owns TWO student-classifying workspaces IS promoted (aggregation does not over-restrict)", async () => {
  // Companion to the R7 P1 test: when ALL qualifying workspaces
  // classify the user as a student (none links them as an
  // instructor), the migration must still promote them. This
  // guards against an over-restrictive aggregation rule that
  // would skip legitimately-student legacy users.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    // A separate instructor whose `_id` we use to set
    // `instructorId` on both workspaces. Neither points at
    // our user's instructor record (which doesn't exist),
    // so both workspaces classify the owner as student.
    const otherInstructorId = await ctx.db.insert("instructors", {
      userId: "user_some_other_instructor_v2",
      email: "other-instructor-v2@example.com",
    });
    await ctx.db.insert("users", {
      userId: "user_two_student_workspaces",
      email: "two-student-workspaces@example.com",
      clerkId: "clerk_two_student_workspaces",
      // role intentionally undefined
    });
    await ctx.db.insert("workspaces", {
      name: "Mentorship Workspace A",
      ownerId: "user_two_student_workspaces",
      instructorId: otherInstructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    await ctx.db.insert("workspaces", {
      name: "Untyped Workspace B",
      ownerId: "user_two_student_workspaces",
      instructorId: otherInstructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      // type undefined
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_two_student_workspaces")
      )
      .first();
  });
  expect(stored?.role).toBe("student");
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: legacy user with undefined role who owns a mentorship workspace AND is its linked instructor is NOT promoted", async () => {
  // Greptile R6 P1: the role resolver at
  // `convex/workspaces.ts:56-64` checks whether the user is the
  // linked instructor BEFORE treating them as the student owner
  // (for `mentorship` / untyped workspaces). A user who owns a
  // workspace AND is its linked instructor resolves as
  // "instructor", not "student". Without this check, the
  // migration would silently flip their role from "instructor"
  // to "student", changing their authorization.
  //
  // This is a real admin-bootstrap data shape: admins sometimes
  // create a workspace on their own account while bootstrapping
  // a session, leaving them both owner and instructor. Such
  // users MUST NOT be promoted.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    // Create the linked instructor record FIRST so we can wire
    // the workspace's `instructorId` to its `_id`.
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_owner_instructor",
      email: "owner-instructor@example.com",
    });
    await ctx.db.insert("users", {
      userId: "user_owner_instructor",
      email: "owner-instructor@example.com",
      clerkId: "clerk_owner_instructor",
      // role intentionally undefined
    });
    await ctx.db.insert("workspaces", {
      name: "Mentorship Where User Is Also Linked Instructor",
      ownerId: "user_owner_instructor",
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_owner_instructor")
      )
      .first();
  });
  expect(stored?.role).toBeUndefined();
  expect(stored?.notificationPreferences).toBeUndefined();
});

test("backfillNotificationPreferences: legacy user with undefined role who owns a mentorship workspace but is NOT its linked instructor IS promoted", async () => {
  // Companion to the linked-instructor test: same shape but the
  // workspace has an `instructorId` that points at a DIFFERENT
  // user's instructor record. The owner is NOT that instructor,
  // so they're a plain student owner and the migration must
  // promote them.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    const otherInstructorId = await ctx.db.insert("instructors", {
      userId: "user_some_other_instructor",
      email: "other-instructor@example.com",
    });
    await ctx.db.insert("users", {
      userId: "user_owner_not_instructor",
      email: "owner-not-instructor@example.com",
      clerkId: "clerk_owner_not_instructor",
      // role intentionally undefined
    });
    await ctx.db.insert("workspaces", {
      name: "Mentorship Where Owner Is Not Linked Instructor",
      ownerId: "user_owner_not_instructor",
      instructorId: otherInstructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_owner_not_instructor")
      )
      .first();
  });
  expect(stored?.role).toBe("student");
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: legacy user with undefined role who owns an UNTYPED workspace is promoted", async () => {
  // Greptile R5 P1: the R4 "mentorship + admin_student only"
  // filter was too narrow. The resolver at
  // `convex/workspaces.ts:39-67` falls through to
  // "ownerId === userId → student" for any workspace that
  // isn't `admin_instructor`, including untyped ones (legacy
  // data shape, before the `type` field was added). The
  // migration must mirror the resolver: exclude ONLY
  // `admin_instructor` ownership.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_untyped_workspace_owner",
      email: "untyped-owner@example.com",
      clerkId: "clerk_untyped_owner",
      // role intentionally undefined
    });
    // No `type` field set — legacy workspace shape. The
    // resolver still classifies this owner as "student".
    await ctx.db.insert("workspaces", {
      name: "Untyped Legacy Workspace",
      ownerId: "user_untyped_workspace_owner",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      // type intentionally undefined
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_untyped_workspace_owner")
      )
      .first();
  });
  expect(stored?.role).toBe("student");
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: legacy user with one admin_instructor AND one untyped workspace is promoted via the untyped one", async () => {
  // Mixed case: user owns both an `admin_instructor` workspace
  // (which does NOT classify them as student) AND an untyped
  // workspace (which DOES). The filter must pick the student-
  // classifying one.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_mixed_untyped_owner",
      email: "mixed-untyped@example.com",
      clerkId: "clerk_mixed_untyped",
      // role undefined
    });
    await ctx.db.insert("workspaces", {
      name: "Admin Instructor Side",
      ownerId: "user_mixed_untyped_owner",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_instructor",
    });
    await ctx.db.insert("workspaces", {
      name: "Untyped Student Workspace",
      ownerId: "user_mixed_untyped_owner",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      // type undefined
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_mixed_untyped_owner")
      )
      .first();
  });
  expect(stored?.role).toBe("student");
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: legacy user with one admin_instructor AND one mentorship workspace gets promoted (filter picks the student one)", async () => {
  // Mixed-workspace-owner case: a user who happens to own an
  // `admin_instructor` workspace AND a `mentorship` workspace
  // (e.g., they transitioned roles). The migration must
  // recognize the student workspace, not blindly reject all
  // because of the admin one.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_mixed_owner",
      email: "mixed-owner@example.com",
      clerkId: "clerk_mixed_owner",
      // role undefined
    });
    await ctx.db.insert("workspaces", {
      name: "Admin Instructor Side Workspace",
      ownerId: "user_mixed_owner",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_instructor",
    });
    await ctx.db.insert("workspaces", {
      name: "Mentorship Workspace",
      ownerId: "user_mixed_owner",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_mixed_owner")
      )
      .first();
  });
  expect(stored?.role).toBe("student");
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: true,
  });
});

test("backfillNotificationPreferences: skips legacy user with undefined role AND no workspace", async () => {
  // A user with undefined role who doesn't own a workspace is
  // not a student by any signal — skip them. Defense against
  // accidentally promoting an unknown role to "student".
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_orphan_undefined",
      email: "orphan-undefined@example.com",
      clerkId: "clerk_orphan_undefined",
      // role undefined, no workspace
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_orphan_undefined")
      )
      .first();
  });
  expect(stored?.role).toBeUndefined();
  expect(stored?.notificationPreferences).toBeUndefined();
});

test("backfillNotificationPreferences: legacy workspace-owner with existing opt-out is left alone", async () => {
  // A legacy student who already opted out (via a previous
  // future-UI run, or some other path) should NOT have their
  // preference rewritten. The migration must respect prior
  // choice even for implicit students.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_legacy_with_optout",
      email: "legacy-optout@example.com",
      clerkId: "clerk_legacy_optout",
      notificationPreferences: { recordingReadyEmail: false },
    });
    await ctx.db.insert("workspaces", {
      name: "Legacy Optout Workspace",
      ownerId: "user_legacy_with_optout",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
  });

  await t.mutation(internal.migrations.backfillNotificationPreferences, {});

  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) =>
        q.eq("userId", "user_legacy_with_optout")
      )
      .first();
  });
  // role still gets stamped (the migration is responsible for
  // role classification), but the opt-out preference is preserved.
  expect(stored?.role).toBe("student");
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: false,
  });
});

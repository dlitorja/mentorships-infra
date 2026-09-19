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

async function seedStudentUser(
  t: ReturnType<typeof convexTest>,
  overrides: {
    userId?: string;
    role?: string;
    notificationPreferences?: unknown;
  } = {}
): Promise<string> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      userId: overrides.userId ?? "user_student_pr4",
      email: "student-pr4@example.com",
      clerkId: "clerk_student_pr4",
      role: (overrides.role as any) ?? "student",
      notificationPreferences: overrides.notificationPreferences,
    });
  });
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
    notificationPreferences: ["nonsense", "array"] as any,
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
    notificationPreferences: { recordingReadyEmail: "yes" as any },
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

test("setNotificationPreference: instructor authenticated as themselves can save their own row", async () => {
  // The mutation is self-authenticating: it writes only to the
  // caller's own row. Instructors don't receive recording-ready
  // emails (the email pipeline targets students), but the
  // backend is intentionally permissive — the frontend gates
  // the toggle visibility by `viewerRole`, and tests confirm the
  // backend doesn't reject valid self-writes from non-students.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  await seedStudentUser(t, { notificationPreferences: undefined });
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_instructor_pr4",
      email: "instructor-pr4-self@example.com",
      clerkId: "clerk_instructor_pr4_self",
      role: "instructor",
    });
  });

  const result = await t
    .withIdentity({ subject: "user_instructor_pr4" })
    .mutation(api.users.setNotificationPreference, {
      key: "recordingReadyEmail",
      value: false,
    });

  expect(result.ok).toBe(true);
  const stored = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_instructor_pr4"))
      .first();
  });
  expect(stored?.notificationPreferences).toMatchObject({
    recordingReadyEmail: false,
  });
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

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { createUser } from "./users";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for `convex/users.ts:deleteUser` defense in depth.
 *
 * Pre-PR #919 the function was a public `mutation` whose doc comment
 * promised "Requires admin auth." but whose handler had no gate. After
 * the PR it is `internalMutation` with an `isAdminUser` sanity check.
 *
 * These tests pin that contract so a future regression back to a public
 * mutation or to removing the gate would fail loudly. The TypeScript
 * type system already enforces the `internalMutation` part — if a
 * future PR reverts the export to `mutation`, `internal.users.deleteUser`
 * will stop resolving and these tests will fail at module load.
 */

type UserRole =
  | "student"
  | "instructor"
  | "admin"
  | "video_editor"
  | "support";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides: {
    userId?: string;
    role?: UserRole;
  } = {}
): Promise<string> {
  return (await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      userId: overrides.userId ?? "user_seed",
      email: `${overrides.userId ?? "user_seed"}@example.com`,
      clerkId: `clerk_${overrides.userId ?? "user_seed"}`,
      role: overrides.role ?? "student",
    });
  })) as string;
}

test("users.deleteUser (internal): rejects authenticated non-admin", async () => {
  const t = convexTest(schema, modules);
  const targetId = await seedUser(t, { userId: "user_target_919b" });
  await seedUser(t, { userId: "user_student_919b", role: "student" });

  await expect(
    t.withIdentity({ subject: "user_student_919b" }).mutation(
      internal.users.deleteUser,
      { id: targetId }
    )
  ).rejects.toThrow("Forbidden");

  // Target row must still exist.
  const stillThere = await t.run(async (ctx) => await ctx.db.get(targetId));
  expect(stillThere).not.toBeNull();
});

test("users.deleteUser (internal): allows admin to delete a user row", async () => {
  const t = convexTest(schema, modules);
  const targetId = await seedUser(t, { userId: "user_target_919c" });
  await seedUser(t, { userId: "user_admin_919c", role: "admin" });

  await t
    .withIdentity({ subject: "user_admin_919c" })
    .mutation(internal.users.deleteUser, { id: targetId });

  const gone = await t.run(async (ctx) => await ctx.db.get(targetId));
  expect(gone).toBeNull();
});

test("users.deleteUser (internal): allows unauthenticated internal caller (cron / system)", async () => {
  // The `isAdminUser` check is intentionally permissive about a missing
  // identity — the `internalMutation` type itself prevents public reach,
  // and Convex's identity model means a missing identity is the system
  // calling (e.g. cron). Pin this so the check is not tightened in a way
  // that breaks future cron-driven deletion.
  const t = convexTest(schema, modules);
  const targetId = await seedUser(t, { userId: "user_target_919d" });

  await t.mutation(internal.users.deleteUser, { id: targetId });

  const gone = await t.run(async (ctx) => await ctx.db.get(targetId));
  expect(gone).toBeNull();
});

test("users.deleteUser (internal): rejects authenticated instructor", async () => {
  // Pin: instructors are NOT admins. A future PR that accidentally
  // broadens `isAdminUser` to "any staff role" would be caught here.
  const t = convexTest(schema, modules);
  const targetId = await seedUser(t, { userId: "user_target_919e" });
  await seedUser(t, { userId: "user_instructor_919e", role: "instructor" });

  await expect(
    t.withIdentity({ subject: "user_instructor_919e" }).mutation(
      internal.users.deleteUser,
      { id: targetId }
    )
  ).rejects.toThrow("Forbidden");
});


/**
 * Security sweep F1 regression guard.
 *
 * `createUser` was a public `mutation` that accepted a client-supplied
 * `role` (including `"admin"`) and `clerkId`. `admin.ts:isAdminUser`
 * trusts the stored `users.role`, so an unauthenticated caller could
 * mint an admin row. It is now `internalMutation`; server callers use
 * the bearer-gated `POST /users/create` endpoint (covered in
 * `http.test.ts`).
 *
 * Typecheck already rejects `api.users.createUser`; this pins the
 * runtime registration too so a future edit cannot silently re-expose it.
 */
test("users.createUser is internal-only (F1 regression guard)", () => {
  const registered = createUser as unknown as {
    isInternal?: boolean;
    isPublic?: boolean;
  };
  expect(registered.isInternal).toBe(true);
  expect(registered.isPublic).toBeUndefined();
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("getCurrentInstructor: returns null when caller has no identity", async () => {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert("instructors", {
      userId: "user_a",
      name: "Alice",
      isActive: true,
    });
  });
  const result = await t.query(api.instructors.getCurrentInstructor, {});
  expect(result).toBeNull();
});

test("getCurrentInstructor: returns the instructor row when identity.subject matches userId", async () => {
  const t = convexTest({ schema, modules });
  const userId = "user_instructor_match";
  let instructorId: string | undefined;
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      userId,
      name: "Matched Instructor",
      isActive: true,
      oneOnOneInventory: 4,
      updatedAt: 1,
    });
  });
  const result = await t
    .withIdentity({ subject: userId })
    .query(api.instructors.getCurrentInstructor, {});
  expect(result).not.toBeNull();
  expect(result?._id).toBe(instructorId);
  expect(result?.userId).toBe(userId);
  expect(result?.name).toBe("Matched Instructor");
});

test("getCurrentInstructor: returns null when the only instructor row has a different userId", async () => {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert("instructors", {
      userId: "user_a",
      name: "Alice",
      isActive: true,
    });
  });
  const result = await t
    .withIdentity({ subject: "user_b" })
    .query(api.instructors.getCurrentInstructor, {});
  expect(result).toBeNull();
});

test("getCurrentInstructor: identity-scoped lookup ignores unrelated rows", async () => {
  // Note: this test verifies that the identity filter works correctly (no row
  // matches), but it does NOT distinguish between an index-backed lookup and a
  // full-table scan. It would pass either way. If you need to assert that the
  // by_userId index is in use, do it via Convex's explain-analyze tooling,
  // not via test fixtures.
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    // Three unrelated rows — none should match user_a.
    await ctx.db.insert("instructors", {
      userId: "user_x",
      name: "X",
      isActive: true,
    });
    await ctx.db.insert("instructors", {
      userId: "user_y",
      name: "Y",
      isActive: true,
    });
    await ctx.db.insert("instructors", {
      userId: "user_z",
      name: "Z",
      isActive: true,
    });
  });
  const result = await t
    .withIdentity({ subject: "user_a" })
    .query(api.instructors.getCurrentInstructor, {});
  expect(result).toBeNull();
});

// Contract test for the query's filter policy. getCurrentInstructor
// intentionally returns the raw row without filtering soft-deleted records.
// Two reasons to keep that policy at the query level:
//
// 1. The auth-helpers JS layer (apps/platform/lib/auth-helpers.ts:
//    hasInstructorRecord) is the single source of truth for "is this
//    instructor currently active for the caller?" — keeping the filter
//    there means every consumer of getCurrentInstructor benefits from the
//    same gating logic. Filtering at the query would scatter the rule
//    across callers (admin views that want soft-deleted rows, audit logs,
//    exports, etc. would each need their own variant of the query).
//
// 2. Filter at the JS layer is unit-tested in PR #877. If a future change
//    moves the filter to the query, the auth-helpers unit test for soft-
//    delete rejection stays valid as a defensive contract — the helper
//    still rejects deleted rows if any query ever returns them.
//
// This test pins the current behavior so the policy is visible in the test
// suite rather than implied.
test("getCurrentInstructor: returns soft-deleted rows (filter lives in the auth-helpers JS layer, not here)", async () => {
  const t = convexTest({ schema, modules });
  const userId = "user_soft_deleted";
  let instructorId: string | undefined;
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      userId,
      name: "Soft Deleted",
      isActive: true,
      deletedAt: 1700000000000,
    });
  });
  const result = await t
    .withIdentity({ subject: userId })
    .query(api.instructors.getCurrentInstructor, {});
  expect(result).not.toBeNull();
  expect(result?._id).toBe(instructorId);
  expect(result?.deletedAt).toBe(1700000000000);
});

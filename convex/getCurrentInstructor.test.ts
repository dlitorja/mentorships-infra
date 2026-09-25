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

test("getCurrentInstructor: identity-scoped lookup ignores unrelated rows (by_userId index in use)", async () => {
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

// Regression guard: getCurrentInstructor intentionally does NOT filter
// soft-deleted rows at the query layer. The auth-helpers JS layer
// (apps/platform/lib/auth-helpers.ts) applies the `row.deletedAt === undefined`
// filter before granting access. If someone "fixes" this query to filter
// deletedAt here, the HUC-47 fallback would silently start allowing soft-deleted
// instructors, because the helper would never see the row to reject it.
// Keep this test as the contract: query returns the raw row, helper filters.
test("getCurrentInstructor: returns soft-deleted rows (intentional — the auth-helpers JS layer is responsible for filtering)", async () => {
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

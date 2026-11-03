/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("list: resolves an admin by clerkId when userId differs", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    // huckleberry-drive keeps the canonical userId separate from the
    // Clerk id; the Clerk identity subject is stored in `clerkId`.
    await ctx.db.insert("users", {
      userId: "canonical_admin_costs",
      clerkId: "user_clerk_admin_costs",
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("monthlyStorageCosts", {
      month: "2026-10",
      totalCost: 1234,
    });
  });

  const result = await t
    .withIdentity({ subject: "user_clerk_admin_costs" })
    .query(api.monthlyStorageCosts.list, {});

  expect(result.historical).toHaveLength(1);
  expect(result.historical[0].totalCost).toBe(1234);
});

test("list: rejects non-admins", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "instructor_costs",
      clerkId: "user_clerk_instructor_costs",
      email: "instructor@example.com",
      role: "instructor",
    });
  });

  await expect(
    t
      .withIdentity({ subject: "user_clerk_instructor_costs" })
      .query(api.monthlyStorageCosts.list, {})
  ).rejects.toThrow("Admin access required");
});

test("list: finds an active admin across linked rows for the same subject", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    // The subject matches a non-admin `by_userId` row AND the admin row's
    // `clerkId`. The old `byUserId ?? byClerkId` short-circuit denied.
    await ctx.db.insert("users", {
      userId: "linked_subject",
      clerkId: "linked_student_clerk",
      email: "student@example.com",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: "linked_admin_canonical",
      clerkId: "linked_subject",
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("monthlyStorageCosts", {
      month: "2026-09",
      totalCost: 99,
    });
  });

  const result = await t
    .withIdentity({ subject: "linked_subject" })
    .query(api.monthlyStorageCosts.list, {});

  expect(result.historical).toHaveLength(1);
  expect(result.historical[0].totalCost).toBe(99);
});

test("list: ignores soft-deleted admins", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "deleted_admin_costs",
      clerkId: "user_deleted_admin_costs",
      email: "deleted@example.com",
      role: "admin",
      deletedAt: Date.now(),
    });
  });

  await expect(
    t
      .withIdentity({ subject: "user_deleted_admin_costs" })
      .query(api.monthlyStorageCosts.list, {})
  ).rejects.toThrow("Admin access required");
});

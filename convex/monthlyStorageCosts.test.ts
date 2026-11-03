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

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Admin orders filtering (audit §5). The orders page sent `status` to a route
 * that dropped it, and searched only the rows on screen — so "Refunded"
 * returned the unfiltered list and a customer search only ever matched page 1.
 *
 * These tests pin the two rules: filters apply to the whole dataset, and
 * `total` counts matches rather than the page.
 */
async function seedOrders() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_admin",
      clerkId: "user_admin",
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: "user_alice",
      clerkId: "user_alice",
      email: "alice@example.com",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: "user_bob",
      clerkId: "user_bob",
      email: "bob@example.com",
      role: "student",
    });

    const statuses = ["paid", "refunded", "paid", "failed"] as const;
    const payers = ["user_alice", "user_bob", "user_bob", "user_alice"];
    for (let i = 0; i < statuses.length; i++) {
      await ctx.db.insert("orders", {
        userId: payers[i],
        status: statuses[i],
        provider: "stripe",
        totalAmount: "100",
        currency: "usd",
      });
    }
  });
  return t;
}

describe("orders.getOrdersForAdmin", () => {
  test("status is applied before pagination and total reflects matches", async () => {
    const t = await seedOrders();

    // limit 1: filtering after slicing would return the newest order overall
    // (a failed one) and a total of 4.
    const result = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, { status: "refunded", limit: 1, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe("refunded");
  });

  test("search by customer email finds orders outside the first page", async () => {
    const t = await seedOrders();

    // Two pages of one: the newest unfiltered order is a different customer's,
    // so a filter-after-slice implementation returns the wrong row and total.
    const firstPage = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, { search: "alice", limit: 1, offset: 0 });
    const secondPage = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, { search: "alice", limit: 1, offset: 1 });

    expect(firstPage.total).toBe(2);
    expect(secondPage.total).toBe(2);
    expect(firstPage.items[0].userEmail).toBe("alice@example.com");
    expect(secondPage.items[0].userEmail).toBe("alice@example.com");
    // The two pages are distinct orders, and the second is not reachable from
    // the unfiltered first page.
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
    expect(secondPage.hasMore).toBe(false);
  });

  test("search by order id returns that order", async () => {
    const t = await seedOrders();
    const all = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, { limit: 20, offset: 0 });
    const targetId = all.items[0].id;

    const result = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, {
        search: targetId.slice(0, 12),
        limit: 20,
        offset: 0,
      });

    expect(result.items.map((order) => order.id)).toContain(targetId);
  });

  test("status and search combine", async () => {
    const t = await seedOrders();

    const result = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, {
        status: "paid",
        search: "bob",
        limit: 1,
        offset: 0,
      });

    expect(result.total).toBe(1);
    expect(result.items[0].status).toBe("paid");
    expect(result.items[0].userEmail).toBe("bob@example.com");
  });

  test("no match is an honest empty result, not the unfiltered list", async () => {
    const t = await seedOrders();

    const result = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, { search: "nobody@example.com", limit: 20, offset: 0 });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  test("rejects a signed-in non-admin: this query returns everyone's orders", async () => {
    const t = await seedOrders();

    await expect(
      t
        .withIdentity({ subject: "user_alice" })
        .query(api.orders.getOrdersForAdmin, { limit: 20, offset: 0 })
    ).rejects.toThrow(/Forbidden/);
  });
});

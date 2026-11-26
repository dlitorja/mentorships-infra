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

  test("joins each order to the session packs its payment created", async () => {
    const t = await seedOrders();
    const asAdmin = t.withIdentity({ subject: "user_admin" });

    const orders = await asAdmin.query(api.orders.getOrdersForAdmin, { limit: 20, offset: 0 });
    const target = orders.items.find((order) => order.status === "paid");
    expect(target).toBeDefined();

    await t.run(async (ctx) => {
      // The seeded orders have no payments yet; create one and a pack that should
      // join through `paymentId`.
      const orderDoc = await ctx.db.get(target!.id as never);
      const paymentId = await ctx.db.insert("payments", {
        orderId: orderDoc!._id,
        provider: "stripe",
        providerPaymentId: "pi_join",
        amount: "100",
        currency: "usd",
        status: "completed",
      });
      const instructorId = await ctx.db.insert("instructors", {
        name: "Ada Instructor",
        slug: "ada",
      });
      await ctx.db.insert("sessionPacks", {
        userId: orderDoc!.userId,
        instructorId,
        totalSessions: 4,
        remainingSessions: 1,
        purchasedAt: Date.now(),
        status: "active",
        paymentId,
      });
      // A pack created by a *different* payment (another order) must not be
      // joined, even though it belongs to the same customer.
      const otherOrderId = await ctx.db.insert("orders", {
        userId: orderDoc!.userId,
        status: "paid",
        provider: "stripe",
        totalAmount: "50",
        currency: "usd",
      });
      const otherPaymentId = await ctx.db.insert("payments", {
        orderId: otherOrderId,
        provider: "stripe",
        providerPaymentId: "pi_other",
        amount: "50",
        currency: "usd",
        status: "completed",
      });
      await ctx.db.insert("sessionPacks", {
        userId: orderDoc!.userId,
        instructorId,
        totalSessions: 2,
        remainingSessions: 2,
        purchasedAt: Date.now(),
        status: "active",
        paymentId: otherPaymentId,
      });
    });

    const refreshed = await asAdmin.query(api.orders.getOrdersForAdmin, { limit: 20, offset: 0 });
    const joined = refreshed.items.find((order) => order.id === target!.id);

    expect(joined?.packs).toHaveLength(1);
    expect(joined?.packs[0]).toMatchObject({
      instructorName: "Ada Instructor",
      totalSessions: 4,
      remainingSessions: 1,
      status: "active",
    });
  });

  test("guest orders still resolve their packs (pack userId differs from the order's)", async () => {
    // Stripe's guest fallback stores the order under `"guest"` while fulfillment
    // writes the pack under an email-based userId. The join must follow the
    // payment, not the customer id.
    const t = convexTest(schema, modules);
    const orderId = await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        userId: "user_admin",
        clerkId: "user_admin",
        email: "admin@example.com",
        role: "admin",
      });
      const id = await ctx.db.insert("orders", {
        userId: "guest",
        status: "paid",
        provider: "stripe",
        totalAmount: "120",
        currency: "usd",
      });
      const paymentId = await ctx.db.insert("payments", {
        orderId: id,
        provider: "stripe",
        providerPaymentId: "pi_guest",
        amount: "120",
        currency: "usd",
        status: "completed",
      });
      const instructorId = await ctx.db.insert("instructors", {
        name: "Guest Instructor",
        slug: "guest-instructor",
      });
      await ctx.db.insert("sessionPacks", {
        userId: "guest@example.com",
        instructorId,
        totalSessions: 4,
        remainingSessions: 4,
        purchasedAt: Date.now(),
        status: "active",
        paymentId,
      });
      return id;
    });

    const result = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, { limit: 20, offset: 0 });

    const order = result.items.find((item) => item.id === orderId);
    expect(order?.packs).toHaveLength(1);
    expect(order?.packs[0]).toMatchObject({
      instructorName: "Guest Instructor",
      totalSessions: 4,
      remainingSessions: 4,
    });
  });

  test("a guest order on the page does not duplicate another customer's packs", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        userId: "user_admin",
        clerkId: "user_admin",
        email: "admin@example.com",
        role: "admin",
      });
      const instructorId = await ctx.db.insert("instructors", { name: "Ada", slug: "ada" });

      // Regular customer with one pack.
      const regularOrder = await ctx.db.insert("orders", {
        userId: "user_regular",
        status: "paid",
        provider: "stripe",
        totalAmount: "100",
        currency: "usd",
      });
      const regularPayment = await ctx.db.insert("payments", {
        orderId: regularOrder,
        provider: "stripe",
        providerPaymentId: "pi_regular",
        amount: "100",
        currency: "usd",
        status: "completed",
      });
      await ctx.db.insert("sessionPacks", {
        userId: "user_regular",
        instructorId,
        totalSessions: 4,
        remainingSessions: 3,
        purchasedAt: Date.now(),
        status: "active",
        paymentId: regularPayment,
      });

      // Guest customer, pack stored under an email-based userId.
      const guestOrder = await ctx.db.insert("orders", {
        userId: "guest",
        status: "paid",
        provider: "stripe",
        totalAmount: "80",
        currency: "usd",
      });
      const guestPayment = await ctx.db.insert("payments", {
        orderId: guestOrder,
        provider: "stripe",
        providerPaymentId: "pi_guest_dup",
        amount: "80",
        currency: "usd",
        status: "completed",
      });
      await ctx.db.insert("sessionPacks", {
        userId: "guest@example.com",
        instructorId,
        totalSessions: 2,
        remainingSessions: 2,
        purchasedAt: Date.now(),
        status: "active",
        paymentId: guestPayment,
      });
    });

    const result = await t
      .withIdentity({ subject: "user_admin" })
      .query(api.orders.getOrdersForAdmin, { limit: 20, offset: 0 });

    const regular = result.items.find((item) => item.userId === "user_regular");
    const guest = result.items.find((item) => item.userId === "guest");
    expect(regular?.packs).toHaveLength(1);
    expect(guest?.packs).toHaveLength(1);
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

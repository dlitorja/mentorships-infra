import { describe, expect, test, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { summariseRevenue } from "./admin";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Revenue aggregation rules the dashboard depends on:
 *
 * - `payments.amount` is already in dollars (the Stripe worker divides
 *   `amount_total` by 100 before persisting; PayPal stores `order.totalAmount`).
 *   `getStats` used to divide again, reporting 1% of actual revenue.
 * - `revenueLastMonth` is a calendar-month window, so it must still report
 *   December in January — a year-to-date read floor silently dropped it.
 */
function payment(amount: string, createdAt: number) {
  return { amount, _creationTime: createdAt };
}

const JAN_15_2027 = new Date("2027-01-15T12:00:00Z");
const DEC_10_2026 = Date.UTC(2026, 11, 10, 12);
const JAN_5_2027 = Date.UTC(2027, 0, 5, 12);
const NOV_20_2026 = Date.UTC(2026, 10, 20, 12);

describe("summariseRevenue", () => {
  test("treats stored amounts as dollars (no extra /100)", () => {
    const summary = summariseRevenue([payment("3750.50", JAN_5_2027)], JAN_15_2027);

    expect(summary.revenueThisMonth).toBe(3750.5);
    expect(summary.revenueThisYear).toBe(3750.5);
    expect(summary.hasRevenueData).toBe(true);
  });

  test("reports December revenue in January", () => {
    // A YTD read floor would have excluded this payment entirely.
    const summary = summariseRevenue([payment("1200", DEC_10_2026)], JAN_15_2027);

    expect(summary.revenueLastMonth).toBe(1200);
    expect(summary.hasHistoricalRevenue).toBe(true);
    // December is last year, so it is not part of this year's revenue.
    expect(summary.revenueThisYear).toBe(0);
  });

  test("month-over-month change compares December to January across the year boundary", () => {
    const summary = summariseRevenue(
      [payment("1200", DEC_10_2026), payment("1800", JAN_5_2027)],
      JAN_15_2027
    );

    expect(summary.revenueLastMonth).toBe(1200);
    expect(summary.revenueThisMonth).toBe(1800);
    expect(summary.revenueChange).toBe(50);
  });

  test("does not count the month before last", () => {
    const summary = summariseRevenue(
      [payment("999", NOV_20_2026), payment("50", DEC_10_2026)],
      JAN_15_2027
    );

    expect(summary.revenueLastMonth).toBe(50);
    expect(summary.hasHistoricalRevenue).toBe(true);
  });

  test("no payments is an honest empty state, not a fabricated zero-with-data", () => {
    const summary = summariseRevenue([], JAN_15_2027);

    expect(summary.hasRevenueData).toBe(false);
    expect(summary.hasHistoricalRevenue).toBe(false);
    expect(summary.revenueThisMonth).toBe(0);
    expect(summary.revenueChange).toBe(0);
  });
});

/**
 * Handler-level guard for the read floor: `getStats` must fetch payments from
 * the start of *last month*, not the start of the year, or January loses
 * December. `_creationTime` follows the fake clock in `convex-test`, so the
 * payment can be stamped in December and read in January.
 */
test("getStats reads December payments when asked in January", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-10T12:00:00Z"));

  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_admin",
      clerkId: "user_admin",
      email: "admin@example.com",
      role: "admin",
    });
    const orderId = await ctx.db.insert("orders", {
      userId: "user_student",
      status: "paid",
      provider: "stripe",
      totalAmount: "1200",
      currency: "usd",
    });
    await ctx.db.insert("payments", {
      orderId,
      provider: "stripe",
      providerPaymentId: "pi_december",
      amount: "1200",
      currency: "usd",
      status: "completed",
    });
  });

  vi.setSystemTime(new Date("2027-01-15T12:00:00Z"));

  const stats = await t
    .withIdentity({ subject: "user_admin" })
    .query(api.admin.getStats, {});

  expect(stats.revenueLastMonth).toBe(1200);
  expect(stats.hasHistoricalRevenue).toBe(true);
  expect(stats.revenueThisMonth).toBe(0);
  expect(stats.revenueThisYear).toBe(0);
});

/** Handler-level guard against re-introducing a currency conversion at read time. */
test("getStats reports dollars, not cents", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_admin",
      clerkId: "user_admin",
      email: "admin@example.com",
      role: "admin",
    });
    const orderId = await ctx.db.insert("orders", {
      userId: "user_student",
      status: "paid",
      provider: "stripe",
      totalAmount: "1200",
      currency: "usd",
    });
    await ctx.db.insert("payments", {
      orderId,
      provider: "stripe",
      providerPaymentId: "pi_today",
      amount: "1200",
      currency: "usd",
      status: "completed",
    });
  });

  const stats = await t
    .withIdentity({ subject: "user_admin" })
    .query(api.admin.getStats, {});

  expect(stats.revenueThisMonth).toBe(1200);
  expect(stats.revenueThisYear).toBe(1200);
});

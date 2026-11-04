/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import * as payments from "./payments";
import * as sessionPacks from "./sessionPacks";
import * as orders from "./orders";

/**
 * Wave 1 (HUC-116) regression guard — money writers.
 *
 * Wave 1a internalized the dead writers (no live callers). Wave 1b adds the
 * live money writers: their implementations are internal, the bearer HTTP
 * endpoints are the only production callers, and the public wrappers are
 * temporary rollout shims removed in the narrow follow-up.
 *
 * Same visibility-metadata pattern as `migrationSurface.test.ts`: the Convex
 * runtime stamps `isInternal` / `isPublic` on every registered function, so a
 * future edit cannot silently re-expose one.
 */

type Visibility = { isInternal?: boolean; isPublic?: boolean };

const modules = import.meta.glob("./**/*.ts");

const INTERNAL_ONLY: ReadonlyArray<readonly [string, string, Visibility]> = [
  ["payments", "createPaymentInternal", payments.createPaymentInternal as Visibility],
  ["payments", "refundPaymentInternal", payments.refundPaymentInternal as Visibility],
  ["sessionPacks", "createSessionPackInternal", sessionPacks.createSessionPackInternal as Visibility],
  ["sessionPacks", "refundSessionPackInternal", sessionPacks.refundSessionPackInternal as Visibility],
  ["orders", "createOrderInternal", orders.createOrderInternal as Visibility],
  ["payments", "updatePayment", payments.updatePayment as Visibility],
  ["payments", "completePayment", payments.completePayment as Visibility],
  ["payments", "failPayment", payments.failPayment as Visibility],
  ["payments", "deletePayment", payments.deletePayment as Visibility],
  ["sessionPacks", "updateSessionPack", sessionPacks.updateSessionPack as Visibility],
  ["sessionPacks", "useSession", sessionPacks.useSession as Visibility],
  ["sessionPacks", "expireSessionPack", sessionPacks.expireSessionPack as Visibility],
  [
    "sessionPacks",
    "processExpiredSessionPacks",
    sessionPacks.processExpiredSessionPacks as Visibility,
  ],
  ["sessionPacks", "deleteSessionPack", sessionPacks.deleteSessionPack as Visibility],
];

test("wave 1 dead money writers are internal-only", () => {
  for (const [moduleName, functionName, visibility] of INTERNAL_ONLY) {
    const label = `${moduleName}.${functionName}`;
    expect(visibility.isInternal, `${label} must be internalMutation`).toBe(true);
    expect(visibility.isPublic, `${label} must not be public`).not.toBe(true);
  }
});

test("public create wrappers do not return existing money records", async () => {
  const t = convexTest({ schema, modules });

  const seeded = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "inst_money_wrapper",
      name: "Wrapper Instructor",
      slug: "wrapper-instructor",
    });
    const orderId = await ctx.db.insert("orders", {
      userId: "user_money_wrapper",
      provider: "stripe",
      totalAmount: "100.00",
      currency: "usd",
      status: "pending",
    });
    const paymentId = await ctx.db.insert("payments", {
      orderId,
      provider: "stripe",
      providerPaymentId: "pi_wrapper_existing",
      amount: "100.00",
      currency: "usd",
      status: "completed",
    });
    await ctx.db.insert("sessionPacks", {
      userId: "user_money_wrapper",
      instructorId,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
      paymentId,
    });
    return { instructorId, orderId, paymentId };
  });

  await expect(
    t.mutation(api.payments.createPayment, {
      orderId: seeded.orderId,
      provider: "stripe",
      providerPaymentId: "pi_wrapper_existing",
      amount: "100.00",
    })
  ).rejects.toThrow("Payment already exists");

  await expect(
    t.mutation(api.sessionPacks.createSessionPack, {
      userId: "user_money_wrapper",
      instructorId: seeded.instructorId,
      paymentId: seeded.paymentId,
    })
  ).rejects.toThrow("Session pack already exists");
});

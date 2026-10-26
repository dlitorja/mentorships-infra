import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAuditLog } from "./auditLog";
import { isAdminUser } from "./admin";

/** Fetches a payment by its ID, returning null if unauthenticated. */
export const getPaymentById = query({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

/** Returns all payments for a given order. */
export const getOrderPayments = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("payments")
      .withIndex("by_orderId", (q) => q.eq("orderId", args.orderId))
      .collect();
  },
});

/** Finds a payment by its provider and provider-specific payment ID. */
export const getPaymentByProviderId = query({
  args: {
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    providerPaymentId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("payments")
      .withIndex("by_provider_providerPaymentId", (q) =>
        q.eq("provider", args.provider).eq("providerPaymentId", args.providerPaymentId)
      )
      .first();
  },
});

/** Finds a completed payment for an order by provider. Used by onboarding flow. */
export const getCompletedPaymentByOrderAndProvider = query({
  args: {
    orderId: v.id("orders"),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_orderId", (q) => q.eq("orderId", args.orderId))
      .filter((q) =>
        q.and(
          q.eq(q.field("provider"), args.provider),
          q.eq(q.field("status"), "completed")
        )
      )
      .first();

    return payments;
  },
});

/** Creates a new payment record for an order. */
export const createPayment = mutation({
  args: {
    orderId: v.id("orders"),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    providerPaymentId: v.string(),
    amount: v.string(),
    currency: v.optional(v.string()),
    status: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("refunded"), v.literal("failed"))),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("payments", {
      ...args,
      currency: args.currency ?? "usd",
      status: args.status ?? "pending",
    });
    return await ctx.db.get(id);
  },
});

/** Updates a payment's status and/or refunded amount. */
export const updatePayment = mutation({
  args: {
    id: v.id("payments"),
    status: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("refunded"), v.literal("failed"))),
    refundedAmount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Marks a payment as completed. */
export const completePayment = mutation({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "completed" });
    return await ctx.db.get(args.id);
  },
});

/** Marks a payment as refunded with the given refunded amount. */
export const refundPayment = mutation({
  args: { id: v.id("payments"), refundedAmount: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { 
      status: "refunded",
      refundedAmount: args.refundedAmount,
    });
    return await ctx.db.get(args.id);
  },
});

/** Marks a payment as failed. */
export const failPayment = mutation({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "failed" });
    return await ctx.db.get(args.id);
  },
});

/**
 * Internal lookup for a single payment by ID. Same shape as the
 * public `getPaymentById`, but only callable from other Convex
 * functions. The refund action (`processRefundForAdmin`) reads
 * the payment via this internal query so the caller is forced to
 * be a Convex function (and the admin gate happens in the caller).
 */
export const getPaymentByIdInternal = internalQuery({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Resolves the Clerk subject of the calling admin, or throws. Shared by
 * the public and internal refund mutations so both enforce the same
 * gate.
 */
async function requireAdminActor(ctx: MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  if (!(await isAdminUser(ctx, identity.subject))) {
    throw new Error("Forbidden: Admin role required");
  }
  return identity.subject;
}

/**
 * Shared refund body for the admin refund mutations. Callers must have
 * already verified that the actor is an admin.
 *
 * Bumps `refundedAmount`, flips payment status `completed → refunded`
 * when fully refunded, flips order status `paid → refunded` when fully
 * refunded, and writes an audit log entry with the actor's Clerk
 * subject. Rejects non-positive or non-numeric amounts, and amounts
 * that would push the total refunded past the original payment.
 */
async function applyAdminRefund(
  ctx: MutationCtx,
  actorId: string,
  args: { paymentId: Id<"payments">; refundAmount: string },
) {
  const payment = await ctx.db.get(args.paymentId);
  if (!payment) throw new Error("Payment not found");

  if (payment.status === "refunded") {
    throw new Error("Payment has already been refunded");
  }

  // `Number()` (not `parseFloat`) so malformed inputs like "25.00junk"
  // are rejected outright instead of silently refunding 25.00.
  const originalAmount = Number(payment.amount);
  const priorRefunded = Number(payment.refundedAmount || "0");
  const delta = Number(args.refundAmount);

  if (!Number.isFinite(delta) || delta <= 0) {
    throw new Error(`Invalid refund amount: ${args.refundAmount}`);
  }
  if (!Number.isFinite(originalAmount) || !Number.isFinite(priorRefunded)) {
    throw new Error("Payment has a non-numeric amount; refusing to refund");
  }

  const newRefundedAmount = (priorRefunded + delta).toFixed(2);

  if (Number(newRefundedAmount) > originalAmount) {
    throw new Error(
      `Refund would exceed original amount (prior=${priorRefunded.toFixed(2)}, ` +
      `requested=${delta.toFixed(2)}, original=${originalAmount.toFixed(2)})`
    );
  }

  const isFullyRefunded = Number(newRefundedAmount) >= originalAmount;

  await ctx.db.patch(args.paymentId, {
    status: isFullyRefunded ? "refunded" : "completed",
    refundedAmount: newRefundedAmount,
  });

  await ctx.db.patch(payment.orderId, {
    status: isFullyRefunded ? "refunded" : "paid",
  });

  await writeAuditLog(ctx, {
    actorId,
    actorRole: "admin",
    action: "admin_refund_completed",
    targetType: "payment",
    targetId: args.paymentId,
    details: `Refunded ${args.refundAmount} of ${originalAmount} (new total refunded: ${newRefundedAmount})`,
    metadata: {
      orderId: payment.orderId,
      originalAmount: payment.amount,
      refundAmount: args.refundAmount,
      newRefundedAmount,
      fullyRefunded: isFullyRefunded,
    },
  });

  return await ctx.db.get(args.paymentId);
}

/**
 * Internal, admin-gated refund mutation. Used by
 * `convex/adminRefunds.ts` after the provider (Stripe / PayPal) refund
 * has already been issued.
 */
export const adminProcessRefundInternal = internalMutation({
  args: {
    paymentId: v.id("payments"),
    refundAmount: v.string(),
  },
  handler: async (ctx, args) => {
    const actorId = await requireAdminActor(ctx);
    return await applyAdminRefund(ctx, actorId, args);
  },
});

/**
 * Admin-only refund bookkeeping for the admin refund routes. The
 * provider refund is issued by the route; this mutation records it.
 *
 * Historically this mutation checked only that the caller was signed
 * in, so any authenticated user could mark a payment refunded, and it
 * skipped the over-refund cap that `adminProcessRefundInternal`
 * enforced. Both mutations now share `applyAdminRefund`.
 */
export const adminProcessRefund = mutation({
  args: {
    paymentId: v.id("payments"),
    refundAmount: v.string(),
  },
  handler: async (ctx, args) => {
    const actorId = await requireAdminActor(ctx);
    return await applyAdminRefund(ctx, actorId, args);
  },
});

/** Soft-deletes a payment by setting its deletedAt timestamp. */
export const deletePayment = mutation({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const migratePayment = internalMutation({
  args: {
    id: v.string(),
    orderId: v.id("orders"),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    providerPaymentId: v.string(),
    amount: v.string(),
    currency: v.optional(v.string()),
    status: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("refunded"), v.literal("failed"))),
    refundedAmount: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByProviderId = await ctx.db
      .query("payments")
      .withIndex("by_provider_providerPaymentId", (q) =>
        q.eq("provider", args.provider).eq("providerPaymentId", args.providerPaymentId)
      )
      .first();

    if (existingByProviderId) {
      const updates: Record<string, unknown> = {};
      if (args.status) updates.status = args.status;
      if (args.refundedAmount) updates.refundedAmount = args.refundedAmount;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByProviderId._id, updates);
      }
      return { action: "updated", id: existingByProviderId._id };
    }

    const insertResult = await ctx.db.insert("payments", {
      orderId: args.orderId,
      provider: args.provider,
      providerPaymentId: args.providerPaymentId,
      amount: args.amount,
      currency: args.currency ?? "usd",
      status: args.status ?? "pending",
      refundedAmount: args.refundedAmount ?? undefined,
    });

    return { action: "inserted", id: insertResult };
  },
});

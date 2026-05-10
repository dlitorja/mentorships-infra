import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
    return await ctx.db.insert("payments", {
      ...args,
      currency: args.currency ?? "usd",
      status: args.status ?? "pending",
    });
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

/** Processes a full refund for a payment and updates the order status. */
export const adminProcessRefund = mutation({
  args: {
    paymentId: v.id("payments"),
    refundAmount: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new Error("Payment not found");

    if (payment.status === "refunded") {
      throw new Error("Payment has already been refunded");
    }

    const originalAmount = parseFloat(payment.amount);
    const newRefundedAmount = (
      parseFloat(payment.refundedAmount || "0") + parseFloat(args.refundAmount)
    ).toFixed(2);

    const isFullyRefunded = parseFloat(newRefundedAmount) >= originalAmount;

    await ctx.db.patch(args.paymentId, {
      status: isFullyRefunded ? "refunded" : "completed",
      refundedAmount: newRefundedAmount,
    });

    await ctx.db.patch(payment.orderId, {
      status: isFullyRefunded ? "refunded" : "paid",
    });

    return await ctx.db.get(args.paymentId);
  },
});

/** Soft-deletes a payment by setting its deletedAt timestamp. */
export const deletePayment = mutation({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const migratePayment = mutation({
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

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

/** Soft-deletes a payment by setting its deletedAt timestamp. */
export const deletePayment = mutation({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

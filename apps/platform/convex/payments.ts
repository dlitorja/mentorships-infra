import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get payments by order
export const listByOrder = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .filter((q) => q.eq(q.field("orderId"), args.orderId))
      .collect();
  },
});

// Get payment by ID
export const getById = query({
  args: { id: v.id("payments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Create payment
export const create = mutation({
  args: {
    orderId: v.id("orders"),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    providerPaymentId: v.string(),
    amount: v.string(),
    currency: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("refunded"),
      v.literal("failed")
    ),
  },
  handler: async (ctx, args) => {
    const paymentId = await ctx.db.insert("payments", args);
    return await ctx.db.get(paymentId);
  },
});

// Update payment
export const update = mutation({
  args: {
    id: v.id("payments"),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("refunded"),
      v.literal("failed")
    )),
    refundedAmount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

// Get all payments (for admin)
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("payments").collect();
  },
});
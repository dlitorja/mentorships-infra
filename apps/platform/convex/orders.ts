import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get orders by user
export const listByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orders")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .collect();
  },
});

// Get order by ID
export const getById = query({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Create order
export const create = mutation({
  args: {
    userId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("refunded"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    totalAmount: v.string(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const orderId = await ctx.db.insert("orders", args);
    return await ctx.db.get(orderId);
  },
});

// Update order
export const update = mutation({
  args: {
    id: v.id("orders"),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("refunded"),
      v.literal("failed"),
      v.literal("canceled")
    )),
  },
  handler: async (ctx, args) => {
    const { id, status } = args;
    await ctx.db.patch(id, { status });
    return await ctx.db.get(id);
  },
});

// Get all orders (for admin)
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orders").collect();
  },
});
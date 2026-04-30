import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** Fetches a single order by ID, returning null if unauthenticated. */
export const getOrderById = query({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

/** Fetches a single order by ID without requiring authentication. Internal use only. */
export const getOrderByIdPublic = query({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return await ctx.db.get(args.id);
  },
});

/** Fetches all orders for a given user ID. */
export const getUserOrders = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("orders")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

/** Fetches all orders matching a given status. */
export const getOrdersByStatus = query({
  args: { status: v.union(v.literal("pending"), v.literal("paid"), v.literal("refunded"), v.literal("failed"), v.literal("canceled")) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("orders")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
  },
});

/** Fetches orders for admin with user and payment info. */
export const getOrdersForAdmin = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    const orders = await ctx.db.query("orders").collect();

    const sortedOrders = orders.sort((a, b) => {
      const aTime = a._creationTime;
      const bTime = b._creationTime;
      return bTime - aTime;
    });

    const paginatedOrders = sortedOrders.slice(offset, offset + limit);

    const ordersWithDetails = await Promise.all(
      paginatedOrders.map(async (order) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", order.userId))
          .first();

        const payments = await ctx.db
          .query("payments")
          .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
          .collect();

        return {
          id: order._id,
          userId: order.userId,
          userEmail: user?.email ?? null,
          status: order.status,
          provider: order.provider,
          totalAmount: order.totalAmount,
          currency: order.currency,
          createdAt: order._creationTime,
          payments: payments.map((p) => ({
            id: p._id,
            provider: p.provider,
            providerPaymentId: p.providerPaymentId,
            amount: p.amount,
            currency: p.currency,
            status: p.status,
            refundedAmount: p.refundedAmount,
          })),
        };
      })
    );

    return {
      items: ordersWithDetails,
      total: orders.length,
      hasMore: offset + limit < orders.length,
    };
  },
});

/** Creates a new order with the given details. */
export const createOrder = mutation({
  args: {
    userId: v.string(),
    status: v.optional(v.union(v.literal("pending"), v.literal("paid"), v.literal("refunded"), v.literal("failed"), v.literal("canceled"))),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    totalAmount: v.string(),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("orders", {
      ...args,
      status: args.status ?? "pending",
      currency: args.currency ?? "usd",
    });
  },
});

/** Updates fields on an existing order and returns the updated document. */
export const updateOrder = mutation({
  args: {
    id: v.id("orders"),
    status: v.optional(v.union(v.literal("pending"), v.literal("paid"), v.literal("refunded"), v.literal("failed"), v.literal("canceled"))),
    totalAmount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Marks an order as paid. */
export const completeOrder = mutation({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "paid" });
    return await ctx.db.get(args.id);
  },
});

/** Marks an order as canceled. */
export const cancelOrder = mutation({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "canceled" });
    return await ctx.db.get(args.id);
  },
});

/** Marks an order as refunded. */
export const refundOrder = mutation({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "refunded" });
    return await ctx.db.get(args.id);
  },
});

/** Soft-deletes an order by setting its deletedAt timestamp. */
export const deleteOrder = mutation({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

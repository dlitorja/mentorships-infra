import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { assertServiceKey } from "./lib/serviceAuth";

/**
 * Internal lookup for a single order by ID. Same shape as the public
 * `getOrderById`, but only callable from other Convex functions. The
 * refund action (`processRefundForAdmin`) reads the order via this
 * internal query so it can build the student-facing email after a
 * successful refund.
 */
export const getOrderByIdInternal = internalQuery({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

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

/** Minimal public order status for client-facing success/cancel flows.
 *
 * Returns only `{ status, provider }` — the two fields the cancel route,
 * Stripe/PayPal success pages, and the Inngest payment processors need to
 * decide what to do next. The previous `getOrderByIdPublic` query exposed
 * the full order document (including `userId`, `packId`, `totalAmount`,
 * `currency`, provider-specific IDs, etc.) to any unauthenticated caller
 * who could guess an ID; this single replacement query closes that gap.
 */
export const getOrderPublicStatus = query({
  args: { id: v.id("orders") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.id);
    if (!order) return null;
    return {
      status: order.status,
      provider: order.provider,
    } as const;
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

export const getOrdersForAdminInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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

/**
 * Creates a new order with the given details.
 *
 * Orders are ALWAYS created as "pending" — the status arg was removed because
 * it allowed anyone to mint orders directly in the "paid" state, bypassing
 * Stripe/PayPal. Payment completion goes through `completeOrder`, which is
 * gated by the service key and only called from verified webhook handlers.
 */
export const createOrder = mutation({
  args: {
    userId: v.string(),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    totalAmount: v.string(),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("orders", {
      ...args,
      status: "pending",
      currency: args.currency ?? "usd",
    });
    return await ctx.db.get(id);
  },
});

/**
 * Marks an order as failed.
 *
 * PUBLIC (no service key required). Used by the checkout routes when a
 * Stripe/PayPal call throws — the order stays in the user's account as a
 * historical record of an attempted purchase.
 *
 * Why only "failed": every legitimate caller (4 checkout routes × 2
 * providers = 9 sites) passes `{id, status: "failed"}` and nothing else.
 * Allowing any other status from a public mutation would let an
 * unauthenticated caller with an order ID mark a pending order
 * "canceled", bypassing the service-key gate on `cancelOrder`. To
 * transition to "canceled", use `cancelOrder`. To transition to "paid"
 * or "refunded", use `completeOrder` / `refundOrder` (both gated).
 *
 * Terminal-state guard: orders already in "paid" or "refunded" cannot
 * be marked "failed" from this path.
 */
export const updateOrder = mutation({
  args: {
    id: v.id("orders"),
    status: v.optional(v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.id);
    if (!order) throw new Error("Order not found");
    if (order.status === "paid" || order.status === "refunded") {
      throw new Error(
        `Cannot update order in terminal state "${order.status}"; use completeOrder/refundOrder for paid/refunded transitions.`,
      );
    }
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/**
 * Marks an order as paid.
 *
 * SERVER-ONLY: gated by the service key. Called from verified Stripe/PayPal
 * webhook handlers (Inngest) and the CONVEX_HTTP_KEY-protected HTTP actions.
 */
export const completeOrder = mutation({
  args: { id: v.id("orders"), serviceKey: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    await ctx.db.patch(args.id, { status: "paid" });
    return await ctx.db.get(args.id);
  },
});

/**
 * Marks an order as canceled.
 *
 * SERVER-ONLY: gated by the service key. The public checkout-cancel route
 * validates an HMAC-signed cancel token AND passes the service key; the
 * token check is at the route layer, the service-key check is at the
 * mutation layer. Without the key, no caller (including the cancel route)
 * could transition an order to "canceled".
 *
 * State guard: only orders currently in "pending" can be canceled.
 * Terminal-state orders (paid/refunded) cannot be re-canceled here;
 * use `refundOrder` for paid orders.
 */
export const cancelOrder = mutation({
  args: { id: v.id("orders"), serviceKey: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const order = await ctx.db.get(args.id);
    if (!order) throw new Error("Order not found");
    if (order.status !== "pending") {
      throw new Error(
        `Cannot cancel order in status "${order.status}"; only "pending" orders can be canceled.`,
      );
    }
    await ctx.db.patch(args.id, { status: "canceled" });
    return await ctx.db.get(args.id);
  },
});

/**
 * Marks an order as refunded.
 *
 * SERVER-ONLY: gated by the service key. Called from verified refund webhook
 * handlers (Inngest) and the CONVEX_HTTP_KEY-protected HTTP actions.
 */
export const refundOrder = mutation({
  args: { id: v.id("orders"), serviceKey: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    await ctx.db.patch(args.id, { status: "refunded" });
    return await ctx.db.get(args.id);
  },
});

/**
 * Soft-deletes an order by setting its deletedAt timestamp.
 *
 * SERVER-ONLY: gated by the service key. No current callers; kept for admin
 * tooling. Do not expose to clients without an admin check.
 */
export const deleteOrder = mutation({
  args: { id: v.id("orders"), serviceKey: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/**
 * One-shot migration helper (scripts/migrate-to-convex/04-migrate-orders.ts).
 *
 * SERVER-ONLY: gated by the service key. Accepts historical statuses including
 * "paid" because it replays real order history — never call this from clients.
 */
export const migrateOrder = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("refunded"), v.literal("failed"), v.literal("canceled")),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    totalAmount: v.string(),
    currency: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    serviceKey: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const existingById = await ctx.db
      .query("orders")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("status"), args.status))
      .first();

    const existing = await ctx.db
      .query("orders")
      .collect()
      .then((orders) => orders.find((o: any) => (o as any)._id === args.id || (o as any).id === args.id));

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.status) updates.status = args.status;
      if (args.totalAmount) updates.totalAmount = args.totalAmount;
      if (args.currency) updates.currency = args.currency;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch((existing as any)._id, updates);
      }
      return { action: "updated", id: (existing as any)._id };
    }

    const insertResult = await ctx.db.insert("orders", {
      userId: args.userId,
      status: args.status,
      provider: args.provider,
      totalAmount: args.totalAmount,
      currency: args.currency ?? "usd",
    });

    return { action: "inserted", id: insertResult };
  },
});

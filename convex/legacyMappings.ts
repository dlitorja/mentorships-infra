import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Internal queries for legacy ID lookups - server-side only
 * These expose sensitive data mappings so must only be called from trusted Convex functions
 */

/**
 * Fetches a user by their legacy ID.
 * Internal use only.
 */
export const getUsersByLegacyId = internalQuery({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
      .collect();
    return users.length > 0 ? users[0] : null;
  },
});

/**
 * Fetches an instructor by their legacy ID.
 * Uses legacyInstructorRef field (not legacyId) for the lookup.
 * Internal use only.
 */
export const getInstructorsByLegacyId = internalQuery({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    // Legacy shim: instructors no longer have `legacyId`; use `legacyInstructorRef` instead.
    const instructors = await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("legacyInstructorRef"), args.legacyId))
      .collect();
    return instructors.length > 0 ? instructors[0] : null;
  },
});

/**
 * Fetches an instructor by their legacy instructor reference.
 * Internal use only.
 */
export const getInstructorsByLegacyRef = internalQuery({
  args: { legacyInstructorRef: v.string() },
  handler: async (ctx, args) => {
    const instructors = await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("legacyInstructorRef"), args.legacyInstructorRef))
      .collect();
    return instructors.length > 0 ? instructors[0] : null;
  },
});

/**
 * Fetches an order by its legacy ID.
 * Internal use only.
 */
export const getOrdersByLegacyId = internalQuery({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
      .collect();
    return orders.length > 0 ? orders[0] : null;
  },
});

/**
 * Fetches a payment by its legacy ID.
 * Internal use only.
 */
export const getPaymentsByLegacyId = internalQuery({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
      .collect();
    return payments.length > 0 ? payments[0] : null;
  },
});

/**
 * Fetches session packs by their legacy ID.
 * Returns all matches (typically one, but may be multiple).
 * Internal use only.
 */
export const getSessionPacksByLegacyId = internalQuery({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const packs = await ctx.db
      .query("sessionPacks")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
      .collect();
    return packs;
  },
});

/**
 * Fetches a user by their Clerk ID.
 * Internal use only.
 */
export const getUsersByClerkId = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .collect();
    return users.length > 0 ? users[0] : null;
  },
});

/**
 * Returns all user ID mappings (legacyId, clerkId, convexId) for migration reference.
 * Internal use only.
 */
export const getAllUsersMappings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      legacyId: u.legacyId ?? u.userId,
      clerkId: u.clerkId,
      convexId: u._id,
    }));
  },
});

/**
 * Returns all instructor ID mappings (legacyId, userId, convexId) for migration reference.
 * Internal use only.
 */
export const getAllInstructorsMappings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const instructors = await ctx.db.query("instructors").collect();
    return instructors.map((i) => ({
      legacyId: i.legacyInstructorRef,
      userId: i.userId,
      convexId: i._id,
    }));
  },
});

/**
 * Returns all order ID mappings (legacyId, userId, convexId) for migration reference.
 * Internal use only.
 */
export const getAllOrdersMappings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    return orders.map((o) => ({
      legacyId: o.legacyId ?? o._id,
      userId: o.userId,
      convexId: o._id,
    }));
  },
});

/**
 * Returns all payment ID mappings (legacyId, orderId, convexId) for migration reference.
 * Internal use only.
 */
export const getAllPaymentsMappings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const payments = await ctx.db.query("payments").collect();
    return payments.map((p) => ({
      legacyId: p.legacyId ?? p._id,
      orderId: p.orderId,
      convexId: p._id,
    }));
  },
});

/**
 * Returns all session pack ID mappings (legacyId, userId, instructorId, paymentId, convexId) for migration reference.
 * Internal use only.
 */
export const getAllSessionPacksMappings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const packs = await ctx.db.query("sessionPacks").collect();
    return packs.map((p) => ({
      legacyId: p.legacyId ?? p._id,
      userId: p.userId,
      instructorId: p.instructorId,
      paymentId: p.paymentId,
      convexId: p._id,
    }));
  },
});

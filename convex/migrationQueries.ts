import { internalQuery, query } from "./_generated/server";

/**
 * Internal queries for migration - server-side only, no auth required
 * These expose full table data so must only be called from trusted Convex functions
 */

/**
 * Fetches all orders for migration purposes.
 * Internal use only - exposes full table data.
 */
export const getAllOrdersForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orders").collect();
  },
});

/**
 * Fetches all payments for migration purposes.
 * Internal use only - exposes full table data.
 */
export const getAllPaymentsForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("payments").collect();
  },
});

/**
 * Fetches all instructors for migration purposes.
 * Internal use only - exposes full table data.
 */
export const getAllInstructorsForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instructors").collect();
  },
});

/**
 * Fetches all session packs for migration purposes.
 * Internal use only - exposes full table data.
 */
export const getAllSessionPacksForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("sessionPacks").collect();
  },
});

/**
 * Fetches all seat reservations for migration purposes.
 * Internal use only - exposes full table data.
 */
export const getAllSeatReservationsForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("seatReservations").collect();
  },
});

/**
 * Fetches session packs belonging to guest users (userId starts with "email:").
 * Used for migrating guest checkout data.
 * Internal use only.
 */
export const getGuestSessionPacksForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allPacks = await ctx.db.query("sessionPacks").collect();
    return allPacks.filter((pack) => pack.userId && pack.userId.startsWith("email:"));
  },
});

export const getGuestSessionPacks = query({
  args: {},
  handler: async (ctx) => {
    const allPacks = await ctx.db.query("sessionPacks").collect();
    return allPacks.filter((pack) => pack.userId && pack.userId.startsWith("email:"));
  },
});
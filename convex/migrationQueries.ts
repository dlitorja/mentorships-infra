import { internalQuery } from "./_generated/server";

/**
 * Internal queries for migration - server-side only, no auth required
 * These expose full table data so must only be called from trusted Convex functions
 */

export const getAllOrdersForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orders").collect();
  },
});

export const getAllPaymentsForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("payments").collect();
  },
});

export const getAllInstructorsForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instructors").collect();
  },
});

export const getAllSessionPacksForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("sessionPacks").collect();
  },
});

export const getAllSeatReservationsForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("seatReservations").collect();
  },
});

export const getGuestSessionPacksForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allPacks = await ctx.db.query("sessionPacks").collect();
    return allPacks.filter((pack) => pack.userId && pack.userId.startsWith("email:"));
  },
});
import { query } from "./_generated/server";

/**
 * Queries for migration - server-side only, no auth required
 * These expose full table data so must only be called from trusted server-side functions
 */

export const getAllOrdersForMigration = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("orders").collect();
  },
});

export const getAllPaymentsForMigration = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("payments").collect();
  },
});

export const getAllInstructorsForMigration = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instructors").collect();
  },
});

export const getAllSessionPacksForMigration = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("sessionPacks").collect();
  },
});

export const getAllSeatReservationsForMigration = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("seatReservations").collect();
  },
});
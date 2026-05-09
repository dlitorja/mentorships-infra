import { query } from "./_generated/server";

/**
 * Internal queries for migration - no auth required
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
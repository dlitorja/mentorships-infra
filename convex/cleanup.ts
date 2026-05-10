import { mutation } from "./_generated/server";

/**
 * WARNING: This mutation deletes ALL records from critical tables.
 * Use only for resetting demo/development environment.
 *
 * Tables cleared: orders, payments, sessionPacks, seatReservations, workspaces,
 *                 workspaceNotes, workspaceLinks, workspaceImages, workspaceMessages,
 *                 workspaceExports, workspaceRetentionNotifications, workspaceAuditLogs,
 *                 discordActionQueue, menteeOnboardingSubmissions, marketingWaitlist
 *
 * Tables preserved: users, instructors, mentors, products, sessions (core demo infrastructure)
 */
export const wipePaymentData = mutation({
  args: {},
  handler: async (ctx) => {
    const results: Record<string, number> = {};

    // Wipe payment-related tables
    const orders = await ctx.db.query("orders").collect();
    for (const doc of orders) {
      await ctx.db.delete(doc._id);
    }
    results.orders = orders.length;

    const payments = await ctx.db.query("payments").collect();
    for (const doc of payments) {
      await ctx.db.delete(doc._id);
    }
    results.payments = payments.length;

    const sessionPacks = await ctx.db.query("sessionPacks").collect();
    for (const doc of sessionPacks) {
      await ctx.db.delete(doc._id);
    }
    results.sessionPacks = sessionPacks.length;

    const seatReservations = await ctx.db.query("seatReservations").collect();
    for (const doc of seatReservations) {
      await ctx.db.delete(doc._id);
    }
    results.seatReservations = seatReservations.length;

    const workspaces = await ctx.db.query("workspaces").collect();
    for (const doc of workspaces) {
      await ctx.db.delete(doc._id);
    }
    results.workspaces = workspaces.length;

    const workspaceNotes = await ctx.db.query("workspaceNotes").collect();
    for (const doc of workspaceNotes) {
      await ctx.db.delete(doc._id);
    }
    results.workspaceNotes = workspaceNotes.length;

    const workspaceLinks = await ctx.db.query("workspaceLinks").collect();
    for (const doc of workspaceLinks) {
      await ctx.db.delete(doc._id);
    }
    results.workspaceLinks = workspaceLinks.length;

    const workspaceImages = await ctx.db.query("workspaceImages").collect();
    for (const doc of workspaceImages) {
      await ctx.db.delete(doc._id);
    }
    results.workspaceImages = workspaceImages.length;

    const workspaceMessages = await ctx.db.query("workspaceMessages").collect();
    for (const doc of workspaceMessages) {
      await ctx.db.delete(doc._id);
    }
    results.workspaceMessages = workspaceMessages.length;

    const workspaceExports = await ctx.db.query("workspaceExports").collect();
    for (const doc of workspaceExports) {
      await ctx.db.delete(doc._id);
    }
    results.workspaceExports = workspaceExports.length;

    const workspaceRetentionNotifications = await ctx.db.query("workspaceRetentionNotifications").collect();
    for (const doc of workspaceRetentionNotifications) {
      await ctx.db.delete(doc._id);
    }
    results.workspaceRetentionNotifications = workspaceRetentionNotifications.length;

    const workspaceAuditLogs = await ctx.db.query("workspaceAuditLogs").collect();
    for (const doc of workspaceAuditLogs) {
      await ctx.db.delete(doc._id);
    }
    results.workspaceAuditLogs = workspaceAuditLogs.length;

    const discordActionQueue = await ctx.db.query("discordActionQueue").collect();
    for (const doc of discordActionQueue) {
      await ctx.db.delete(doc._id);
    }
    results.discordActionQueue = discordActionQueue.length;

    const menteeOnboardingSubmissions = await ctx.db.query("menteeOnboardingSubmissions").collect();
    for (const doc of menteeOnboardingSubmissions) {
      await ctx.db.delete(doc._id);
    }
    results.menteeOnboardingSubmissions = menteeOnboardingSubmissions.length;

    const marketingWaitlist = await ctx.db.query("marketingWaitlist").collect();
    for (const doc of marketingWaitlist) {
      await ctx.db.delete(doc._id);
    }
    results.marketingWaitlist = marketingWaitlist.length;

    return { success: true, deleted: results };
  },
});


import { mutation } from "./_generated/server";
import { writeAuditLog } from "./auditLog";

/**
 * WARNING: This mutation deletes ALL records from critical tables.
 * Use only for resetting demo/development environment.
 *
 * Tables cleared: orders, payments, sessionPacks, seatReservations, workspaces,
 *                 workspaceNotes, workspaceLinks, workspaceImages, workspaceMessages,
 *                 workspaceExports, workspaceRetentionNotifications, workspaceAuditLogs,
 *                 discordActionQueue, studentOnboardingSubmissions, marketingWaitlist
 *
 * Tables preserved: users, instructors, products, sessions (core demo infrastructure)
 *
 * Audit-log wiring (FIX F5 from the security-audit pilot at commit 9fbf1794):
 *
 * Two `auditLogs` rows are written in the same transaction as the destructive
 * loop, using the codebase's existing `writeAuditLog` helper from
 * `convex/auditLog.ts`. `writeAuditLog` writes to the `auditLogs` table
 * (NOT `workspaceAuditLogs`); see the docstring at `convex/auditLog.ts:7-32`
 * for the explicit distinction. `auditLogs` is NOT in the wipe list, so both
 * rows survive the deletion.
 *
 * Failure semantics: Convex mutations are all-or-nothing. If the deletion loop
 * throws mid-flight, the transaction is rolled back — partial deletes AND
 * the `begin` audit row are undone together. There is no audit row left
 * behind to misread as "the wipe ran but we lost the audit." The forensic
 * invariant is: an audit-record pair exists if and only if the wipe
 * committed.
 *
 * Privacy: `metadata.results` carries per-table counts only (no payment
 * data, no user emails, no provider payment IDs).
 *
 * Validation:
 *   - `convex/cleanup.test.ts` covers unauthenticated and non-admin
 *     rejection, exactly one `wipe_payment_data_begin` and one
 *     `wipe_payment_data_complete` row on a successful admin call,
 *     counts-only metadata, and that both rows survive the wipe of
 *     `workspaceAuditLogs`. The fixtures seed every asserted table
 *     non-empty, so a skipped delete loop fails the count and the
 *     emptiness assertions rather than passing on zeros.
 *   - The rollback invariant (an audit pair exists if and only if the wipe
 *     committed) is a Convex transaction property. It is not exercised by
 *     convex-test because a mid-loop delete failure cannot be injected
 *     without patching the mutation itself.
 */
export const wipePaymentData = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("clerkId"), identity.subject))
      .first();
    if (!user || user.role !== "admin") {
      throw new Error("Forbidden: Admin role required");
    }

    const auditTargets = [
      "orders",
      "payments",
      "sessionPacks",
      "seatReservations",
      "workspaces",
      "workspaceNotes",
      "workspaceLinks",
      "workspaceImages",
      "workspaceMessages",
      "workspaceExports",
      "workspaceRetentionNotifications",
      "workspaceAuditLogs",
      "discordActionQueue",
      "studentOnboardingSubmissions",
      "marketingWaitlist",
    ];

    // Begin audit row — written inside the same transaction as the deletions.
    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: "admin",
      action: "wipe_payment_data_begin",
      targetType: "system_state",
      targetId: "global",
      details: `Admin ${identity.subject} initiated wipe across ${auditTargets.length} tables`,
      metadata: { tables: auditTargets },
    });

    const results: Record<string, number> = {};

    // Wipe payment-related tables. The audit row written above will only
    // commit alongside these deletions if every block completes without
    // throwing; if any deletion throws, the transaction rolls back
    // everything in this handler.
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

    const studentOnboardingSubmissions = await ctx.db.query("studentOnboardingSubmissions").collect();
    for (const doc of studentOnboardingSubmissions) {
      await ctx.db.delete(doc._id);
    }
    results.studentOnboardingSubmissions = studentOnboardingSubmissions.length;

    const marketingWaitlist = await ctx.db.query("marketingWaitlist").collect();
    for (const doc of marketingWaitlist) {
      await ctx.db.delete(doc._id);
    }
    results.marketingWaitlist = marketingWaitlist.length;

    // Complete audit row — written inside the same transaction.
    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: "admin",
      action: "wipe_payment_data_complete",
      targetType: "system_state",
      targetId: "global",
      details: `Wipe complete per-table counts: ${JSON.stringify(results)}`,
      metadata: { results },
    });

    return { success: true, deleted: results };
  },
});

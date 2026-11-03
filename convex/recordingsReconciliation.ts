import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Session rows the recordings-bucket reconciliation diffs against.
 *
 * Returned **by status, not by URL**: `purged` rows have `recordingUrl`
 * cleared by `markRecordingDeleted`, and `failed` rows may never have had
 * one — filtering on `recordingUrl` would make their objects look like
 * orphans, and the job would delete the only surviving copy of a failed
 * transfer.
 *
 * The weekly job runs in Trigger.dev (S3-compatible API), because the
 * Convex deployment's B2 key is not entitled to the native API. This
 * query is served over `/recordings-reconciliation/sessions`.
 */
export const listSessionsForReconciliation = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    // Paginated: the table grows with all history, so an unpaginated read
    // eventually exceeds Convex's per-query read limits and would fail the
    // whole weekly job.
    const page = await ctx.db
      .query("sessions")
      .paginate(args.paginationOpts);
    const sessions: Array<{
      sessionId: string;
      status?: string;
      recordingUrl?: string;
      expiresAt?: number;
    }> = [];

    for (const session of page.page) {
      const status = session.recordingTransferStatus;
      if (status === undefined) continue;
      sessions.push({
        sessionId: session._id,
        status,
        recordingUrl: session.recordingUrl,
        expiresAt: session.recordingExpiresAt,
      });
    }

    return {
      sessions,
      count: sessions.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

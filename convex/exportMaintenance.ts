import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { EXPORT_ARTIFACT_TTL_MS } from "./workspaceConstants";

/**
 * Housekeeping for generated export records.
 *
 * The artifacts themselves (B2 ZIP/CSV) are deleted by the Trigger.dev
 * sweep `cleanup-export-artifacts` using the same 72-hour window. This
 * mutation keeps the Convex rows in step:
 *
 *   - terminal rows (`completed` / `failed`) older than the TTL are
 *     deleted, so the tabs stop listing exports whose artifact is gone;
 *   - a row still `pending` / `processing` after the TTL is marked
 *     failed. Trigger tasks finish in minutes; anything older is
 *     abandoned (lost run, cancelled deployment). It is deleted on the
 *     next tick once terminal.
 *
 * `olderThan` is an injection point for tests (the cron passes
 * nothing). Rows are scanned oldest-first in bounded batches, so a
 * backlog drains over successive hourly ticks instead of one long
 * transaction.
 */
const BATCH_LIMIT = 200;
const TIMEOUT_MESSAGE =
  "Export timed out before completion; export artifacts expire after 72 hours.";

function thresholdFrom(olderThan: number | undefined): number {
  return olderThan ?? Date.now() - EXPORT_ARTIFACT_TTL_MS;
}

export const pruneExpiredExportRecords = internalMutation({
  args: {
    // Rows created before this epoch-ms are expired.
    olderThan: v.optional(v.number()),
  },
  returns: v.object({
    workspaceExportsDeleted: v.number(),
    workspaceExportsTimedOut: v.number(),
    artworkExportsDeleted: v.number(),
    artworkExportsTimedOut: v.number(),
  }),
  handler: async (ctx, args) => {
    const threshold = thresholdFrom(args.olderThan);

    let workspaceExportsDeleted = 0;
    let workspaceExportsTimedOut = 0;
    const workspaceRows = await ctx.db
      .query("workspaceExports")
      .order("asc")
      .take(BATCH_LIMIT);
    for (const row of workspaceRows) {
      if (row._creationTime >= threshold) break;
      if (row.status === "pending" || row.status === "processing") {
        await ctx.db.patch(row._id, {
          status: "failed",
          errorMessage: TIMEOUT_MESSAGE,
        });
        workspaceExportsTimedOut++;
        continue;
      }
      await ctx.db.delete(row._id);
      workspaceExportsDeleted++;
    }

    let artworkExportsDeleted = 0;
    let artworkExportsTimedOut = 0;
    const artworkRows = await ctx.db
      .query("onboardingArtworkExports")
      .order("asc")
      .take(BATCH_LIMIT);
    for (const row of artworkRows) {
      if (row._creationTime >= threshold) break;
      if (row.status === "pending" || row.status === "processing") {
        await ctx.db.patch(row._id, {
          status: "failed",
          errorMessage: TIMEOUT_MESSAGE,
        });
        artworkExportsTimedOut++;
        continue;
      }
      await ctx.db.delete(row._id);
      artworkExportsDeleted++;
    }

    return {
      workspaceExportsDeleted,
      workspaceExportsTimedOut,
      artworkExportsDeleted,
      artworkExportsTimedOut,
    };
  },
});

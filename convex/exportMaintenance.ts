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
 *   - a row past its artifact's expiry is deleted once terminal
 *     (`completed` / `failed`), so the tabs stop listing exports whose
 *     artifact is gone;
 *   - a row still `pending` / `processing` after the TTL is marked
 *     failed. Trigger tasks finish in minutes; anything older is
 *     abandoned (lost run, cancelled deployment). It is deleted on the
 *     next tick once terminal.
 *
 * Expiry is measured from *completion* (`expiresAt`, set by the worker
 * when the artifact is written), not from row creation: a queued or
 * slow export keeps its full 72-hour window. Rows without `expiresAt`
 * (failed / abandoned) fall back to `_creationTime + TTL`.
 *
 * `now` is an injection point for tests (the cron passes nothing). Rows
 * are scanned oldest-first in bounded batches, so a backlog drains over
 * successive hourly ticks instead of one long transaction.
 */
const BATCH_LIMIT = 200;
const TIMEOUT_MESSAGE =
  "Export timed out before completion; export artifacts expire after 72 hours.";

/** When this row's artifact becomes eligible for deletion. */
function artifactExpiresAt(row: {
  expiresAt?: number;
  _creationTime: number;
}): number {
  return row.expiresAt ?? row._creationTime + EXPORT_ARTIFACT_TTL_MS;
}

/** Creation-based floor: a row this new cannot have an expired artifact. */
function cannotBeExpiredYet(_creationTime: number, now: number): boolean {
  return _creationTime + EXPORT_ARTIFACT_TTL_MS > now;
}

export const pruneExpiredExportRecords = internalMutation({
  args: {
    // Evaluation time in epoch ms (defaults to now).
    now: v.optional(v.number()),
  },
  returns: v.object({
    workspaceExportsDeleted: v.number(),
    workspaceExportsTimedOut: v.number(),
    artworkExportsDeleted: v.number(),
    artworkExportsTimedOut: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();

    let workspaceExportsDeleted = 0;
    let workspaceExportsTimedOut = 0;
    const workspaceRows = await ctx.db
      .query("workspaceExports")
      .order("asc")
      .take(BATCH_LIMIT);
    for (const row of workspaceRows) {
      if (cannotBeExpiredYet(row._creationTime, now)) break;
      if (row.status === "pending" || row.status === "processing") {
        await ctx.db.patch(row._id, {
          status: "failed",
          errorMessage: TIMEOUT_MESSAGE,
        });
        workspaceExportsTimedOut++;
        continue;
      }
      // A slow task can finish after its row was created; keep the row
      // until the artifact's own expiry has passed.
      if (artifactExpiresAt(row) > now) continue;
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
      if (cannotBeExpiredYet(row._creationTime, now)) break;
      if (row.status === "pending" || row.status === "processing") {
        await ctx.db.patch(row._id, {
          status: "failed",
          errorMessage: TIMEOUT_MESSAGE,
        });
        artworkExportsTimedOut++;
        continue;
      }
      if (artifactExpiresAt(row) > now) continue;
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

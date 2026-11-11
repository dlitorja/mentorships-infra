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
 *   - completed rows whose `expiresAt` (completion + 72h, written by the
 *     worker) has passed are deleted — the artifact's signed URL is dead
 *     and the object has been swept;
 *   - failed rows older than the window are deleted;
 *   - a row still `pending` / `processing` after the window is marked
 *     failed. Trigger tasks finish in minutes; anything older is
 *     abandoned (lost run, cancelled deployment). The next tick deletes
 *     the now-terminal row.
 *
 * Each case uses an index (`by_expiresAt` / `by_status`) instead of one
 * oldest-first scan: rows that completed late but still have a valid
 * download must not push newer, already-expired rows out of the batch.
 *
 * `now` is an injection point for tests (the cron passes nothing).
 */
const BATCH_LIMIT = 200;
const TIMEOUT_MESSAGE =
  "Export timed out before completion; export artifacts expire after 72 hours.";

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
    // Failed/abandoned rows have no artifact expiry; fall back to
    // creation + TTL.
    const creationFloor = now - EXPORT_ARTIFACT_TTL_MS;

    let workspaceExportsDeleted = 0;
    let workspaceExportsTimedOut = 0;
    let artworkExportsDeleted = 0;
    let artworkExportsTimedOut = 0;

    // 1) Completed artifacts past their signed-URL expiry. The index
    // range starts at 0 so rows without `expiresAt` (undefined sorts
    // before numbers) are not swept before their artifact exists.
    const expiredWorkspace = await ctx.db
      .query("workspaceExports")
      .withIndex("by_expiresAt", (q) => q.gte("expiresAt", 0).lt("expiresAt", now))
      .take(BATCH_LIMIT);
    for (const row of expiredWorkspace) {
      await ctx.db.delete(row._id);
      workspaceExportsDeleted++;
    }

    const expiredArtwork = await ctx.db
      .query("onboardingArtworkExports")
      .withIndex("by_expiresAt", (q) => q.gte("expiresAt", 0).lt("expiresAt", now))
      .take(BATCH_LIMIT);
    for (const row of expiredArtwork) {
      await ctx.db.delete(row._id);
      artworkExportsDeleted++;
    }

    // 1b) Legacy completed rows that never got an `expiresAt` (all rows
    // written by the current workers do) are pruned by age instead.
    const legacyWorkspace = await ctx.db
      .query("workspaceExports")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .filter((q) =>
        q.and(
          q.lt(q.field("_creationTime"), creationFloor),
          q.eq(q.field("expiresAt"), undefined)
        )
      )
      .take(BATCH_LIMIT);
    for (const row of legacyWorkspace) {
      await ctx.db.delete(row._id);
      workspaceExportsDeleted++;
    }

    const legacyArtwork = await ctx.db
      .query("onboardingArtworkExports")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .filter((q) =>
        q.and(
          q.lt(q.field("_creationTime"), creationFloor),
          q.eq(q.field("expiresAt"), undefined)
        )
      )
      .take(BATCH_LIMIT);
    for (const row of legacyArtwork) {
      await ctx.db.delete(row._id);
      artworkExportsDeleted++;
    }

    // 2) Old failed rows (no artifact left to wait for).
    const failedWorkspace = await ctx.db
      .query("workspaceExports")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.lt(q.field("_creationTime"), creationFloor))
      .take(BATCH_LIMIT);
    for (const row of failedWorkspace) {
      await ctx.db.delete(row._id);
      workspaceExportsDeleted++;
    }

    const failedArtwork = await ctx.db
      .query("onboardingArtworkExports")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.lt(q.field("_creationTime"), creationFloor))
      .take(BATCH_LIMIT);
    for (const row of failedArtwork) {
      await ctx.db.delete(row._id);
      artworkExportsDeleted++;
    }

    // 3) Abandoned in-flight rows.
    for (const status of ["pending", "processing"] as const) {
      const stuckWorkspace = await ctx.db
        .query("workspaceExports")
        .withIndex("by_status", (q) => q.eq("status", status))
        .filter((q) => q.lt(q.field("_creationTime"), creationFloor))
        .take(BATCH_LIMIT);
      for (const row of stuckWorkspace) {
        await ctx.db.patch(row._id, {
          status: "failed",
          errorMessage: TIMEOUT_MESSAGE,
        });
        workspaceExportsTimedOut++;
      }

      const stuckArtwork = await ctx.db
        .query("onboardingArtworkExports")
        .withIndex("by_status", (q) => q.eq("status", status))
        .filter((q) => q.lt(q.field("_creationTime"), creationFloor))
        .take(BATCH_LIMIT);
      for (const row of stuckArtwork) {
        await ctx.db.patch(row._id, {
          status: "failed",
          errorMessage: TIMEOUT_MESSAGE,
        });
        artworkExportsTimedOut++;
      }
    }

    return {
      workspaceExportsDeleted,
      workspaceExportsTimedOut,
      artworkExportsDeleted,
      artworkExportsTimedOut,
    };
  },
});

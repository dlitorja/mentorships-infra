import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * HUC-58 backfill helpers for the denormalized storage counter.
 *
 * The action (`convex/actions/backfillVideoEditorStorageCounter.ts`)
 * drives the hourly cron. It paginates `instructorUploads` via
 * `getUploadsPage` (an internal query) to stay under Convex's
 * per-mutation read limit (32k reads / mutation). The aggregate
 * lives in the action's memory across batches. Once the walk is
 * complete, the action calls `setVideoEditorStorageCounterBatch`
 * to write all editors in one mutation.
 *
 * Idempotency: re-running the action with no changes produces
 * identical writes. The mutation skips writes when the value is
 * unchanged.
 */

const PAGE_SIZE = 5_000;

export const getUploadsPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("instructorUploads")
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
    return {
      rows: page.page,
      isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const setVideoEditorStorageCounterBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        videoEditorId: v.string(),
        usedBytes: v.number(),
        fileCount: v.number(),
      })
    ),
    // Timestamp recorded by the action BEFORE it started scanning
    // uploads. Used to prevent the action from overwriting a
    // counter that a concurrent mutation has touched during the
    // scan (round-25 Greptile P1 #3): if `existing.lastUpdatedAt >
    // scanStartTime`, the mutation has fresher data than the scan,
    // so we skip the write.
    scanStartTime: v.number(),
  },
  handler: async (ctx, args) => {
    const lastUpdatedAt = Date.now();
    let written = 0;
    let unchanged = 0;
    let skippedByMutation = 0;
    for (const entry of args.entries) {
      const existing = await ctx.db
        .query("videoEditorStorageStats")
        .withIndex("by_videoEditorId", (q) =>
          q.eq("videoEditorId", entry.videoEditorId)
        )
        .first();
      if (existing) {
        // If a mutation has touched this counter since the scan
        // started, the mutation's value is fresher than the scan's.
        // Skip the write to avoid clobbering it.
        if (existing.lastUpdatedAt > args.scanStartTime) {
          skippedByMutation += 1;
          continue;
        }
        if (
          existing.usedBytes === entry.usedBytes &&
          existing.fileCount === entry.fileCount
        ) {
          // Values match: still refresh lastUpdatedAt so the
          // staleness check on the dashboard reflects the last
          // successful cron run, not the last actual change. The
          // dashboard would otherwise surface a false "stale" badge
          // for long-quiescent editors whose totals are stable.
          // (round-24 Greptile P2 #1)
          await ctx.db.patch(existing._id, { lastUpdatedAt });
          unchanged += 1;
          continue;
        }
        await ctx.db.patch(existing._id, {
          usedBytes: entry.usedBytes,
          fileCount: entry.fileCount,
          lastUpdatedAt,
        });
      } else {
        await ctx.db.insert("videoEditorStorageStats", {
          videoEditorId: entry.videoEditorId,
          usedBytes: entry.usedBytes,
          fileCount: entry.fileCount,
          lastUpdatedAt,
        });
      }
      written += 1;
    }
    return { written, unchanged, skippedByMutation };
  },
});

/**
 * Status helper for observability: counts counter rows and reports
 * the latest update timestamp.
 */
export const backfillVideoEditorStorageCounterStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const counterRows = await ctx.db
      .query("videoEditorStorageStats")
      .collect();
    const totalEditors = counterRows.length;
    const lastUpdatedAt = counterRows.reduce(
      (max, row) => Math.max(max, row.lastUpdatedAt),
      0
    );
    return { editorsWithCounter: totalEditors, lastUpdatedAt };
  },
});

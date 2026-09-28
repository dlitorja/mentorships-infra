import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * HUC-58 backfill helpers for the denormalized storage counter.
 *
 * `runBackfillVideoEditorStorageCounter` (in
 * `convex/actions/backfillVideoEditorStorageCounter.ts`) drives the
 * hourly cron and walks the upload table in bounded, resumable
 * batches. Each batch:
 *   1. Reads up to BATCH_SIZE `instructorUploads` rows.
 *   2. Aggregates active bytes per `uploadedById`.
 *   3. Writes the aggregate to `videoEditorStorageStats` (idempotent
 *      via the `by_videoEditorId` index).
 *
 * Idempotency: re-running the batch with the same cursor produces
 * the same writes. The full backfill is therefore resumable across
 * hourly cron invocations.
 *
 * Each batch is bounded so it stays under Convex's per-mutation
 * read limit (32k reads / mutation). For tables with many more
 * rows than that, multiple batches are required.
 */
const BATCH_SIZE = 5_000;

interface BatchAggregate {
  usedBytes: number;
  fileCount: number;
}

export const backfillVideoEditorStorageCounterBatch = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("instructorUploads")
      .paginate({ cursor: args.cursor, numItems: BATCH_SIZE });

    const aggregates = new Map<string, BatchAggregate>();
    for (const row of page.page) {
      if (!row.uploadedById) continue;
      if (row.status === "deleted" || row.status === "deleting") continue;
      const existing = aggregates.get(row.uploadedById);
      if (existing) {
        existing.usedBytes += row.size;
        existing.fileCount += 1;
      } else {
        aggregates.set(row.uploadedById, { usedBytes: row.size, fileCount: 1 });
      }
    }

    let written = 0;
    let unchanged = 0;
    for (const [videoEditorId, agg] of aggregates) {
      const existing = await ctx.db
        .query("videoEditorStorageStats")
        .withIndex("by_videoEditorId", (q) =>
          q.eq("videoEditorId", videoEditorId)
        )
        .first();
      if (existing) {
        // Skip the patch when the value is unchanged. This keeps
        // unchanged counters from being touched on every hourly run
        // (P2 #2 from round-23 Greptile). The lastUpdatedAt is only
        // refreshed when the value actually changes, so genuine drift
        // triggers a re-write but a no-change backfill is cheap.
        if (
          existing.usedBytes === agg.usedBytes &&
          existing.fileCount === agg.fileCount
        ) {
          unchanged += 1;
          continue;
        }
        await ctx.db.patch(existing._id, {
          usedBytes: agg.usedBytes,
          fileCount: agg.fileCount,
          lastUpdatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("videoEditorStorageStats", {
          videoEditorId,
          usedBytes: agg.usedBytes,
          fileCount: agg.fileCount,
          lastUpdatedAt: Date.now(),
        });
      }
      written += 1;
    }

    return {
      rowsScanned: page.page.length,
      editorsWritten: written,
      editorsUnchanged: unchanged,
      isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Status helper for observability: counts counter rows and reports
 * the latest update timestamp. Used by the cron to skip work when
 * all rows already have a counter row.
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

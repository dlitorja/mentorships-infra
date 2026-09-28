import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Single-mutation full-scan backfill for the HUC-58 denormalized
 * storage counter. Reads every `instructorUploads` row in one
 * transaction, aggregates active bytes per `uploadedById`, and
 * writes the resulting counters to `videoEditorStorageStats`.
 *
 * Idempotent: re-running writes the same values. Called from the
 * hourly `runBackfillVideoEditorStorageCounter` cron.
 *
 * Bounded by Convex's per-mutation row-read limit (currently 32k
 * reads per mutation). For larger scales, split into paginated
 * batches with intermediate state in a `backfillCursor` table —
 * not currently needed.
 */
export const backfillVideoEditorStorageCounterFull = internalMutation({
  args: {},
  handler: async (ctx) => {
    const uploads = await ctx.db.query("instructorUploads").collect();
    const aggregates = new Map<string, { usedBytes: number; fileCount: number }>();
    for (const row of uploads) {
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
    for (const [videoEditorId, agg] of aggregates) {
      const existing = await ctx.db
        .query("videoEditorStorageStats")
        .withIndex("by_videoEditorId", (q) =>
          q.eq("videoEditorId", videoEditorId)
        )
        .first();
      if (existing) {
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
      rowsScanned: uploads.length,
      editorsWritten: written,
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

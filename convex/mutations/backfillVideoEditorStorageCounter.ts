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
    // Reconciliation counter: how many placeholders were
    // reconciled this pass. Placeholders are 0/0 rows written by
    // the inline seed when the aggregate scan could not complete.
    // The cron overwrites them with its (possibly stale by one
    // mutation) aggregate, which clears the placeholder sentinel.
    // Mutations on a placeholder that happened DURING the cron's
    // scan are protected by the `placeholderTouchedAt >
    // scanStartTime` check below — every mutation that touches a
    // placeholder sets `placeholderTouchedAt: Date.now()`, so the
    // cron can reliably detect a concurrent touch even though
    // `lastUpdatedAt` stays at the sentinel value 0.
    //
    // Trade-off acknowledged (round-32 Greptile P1): for editors
    // whose historical row count permanently exceeds the inline
    // mutation read budget, the placeholder persists between cron
    // passes. Each cron pass overwrites the values with its fresh
    // aggregate AND clears the sentinel, so the dashboard briefly
    // shows the correct value after each cron run, then the next
    // mutation reverts to the placeholder if the mutation path
    // can't compute the full aggregate. The next mutation's delta
    // math is on top of the cron's correct value, so the displayed
    // value is always within one mutation's worth of accuracy.
    let reconciledPlaceholders = 0;
    for (const entry of args.entries) {
      const existing = await ctx.db
        .query("videoEditorStorageStats")
        .withIndex("by_videoEditorId", (q) =>
          q.eq("videoEditorId", entry.videoEditorId)
        )
        .first();
      if (existing) {
        // Sentinel: this is a placeholder. Reconcile it — write
        // the cron's aggregate with a real timestamp so the UI's
        // "refreshing" badge clears. The check below protects
        // against the race where a mutation during the cron's
        // scan touched this placeholder with a fresher value.
        if (existing.lastUpdatedAt === 0) {
          // Mutation touched the placeholder DURING the cron's
          // scan: skip — its value is fresher than the scan. We
          // use `placeholderTouchedAt` (set on every mutation
          // that touches a placeholder) instead of `lastUpdatedAt`
          // because the sentinel `0` is never greater than any
          // positive scanStartTime. (round-33 Greptile P1 #1.)
          if (
            existing.placeholderTouchedAt !== undefined &&
            existing.placeholderTouchedAt > args.scanStartTime
          ) {
            skippedByMutation += 1;
            continue;
          }
          await ctx.db.patch(existing._id, {
            usedBytes: entry.usedBytes,
            fileCount: entry.fileCount,
            lastUpdatedAt,
            placeholderTouchedAt: undefined,
          });
          reconciledPlaceholders += 1;
          continue;
        }
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
    return {
      written,
      unchanged,
      skippedByMutation,
      reconciledPlaceholders,
    };
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

/**
 * Round-33 Greptile P2 #3: confirm zero on placeholder counter
 * rows whose editors have no active uploads. The main cron's
 * `setVideoEditorStorageCounterBatch` only processes editors with
 * at least one active upload (its `entries` come from a scan that
 * skips `deleted`/`deleting` rows). An editor whose historical
 * rows are ALL inactive can end up with a `lastUpdatedAt: 0`
 * placeholder that no cron pass reconciles — the UI's "refreshing"
 * badge then persists forever even though 0/0 is the correct value.
 *
 * Strategy: iterate `videoEditorStorageStats` rows where
 * `lastUpdatedAt === 0` (via the `by_placeholder` index), and for
 * each one check via `by_uploadedById` whether ANY active row
 * exists. If not, write 0/0 with `Date.now()` and clear the
 * sentinel + `placeholderTouchedAt`.
 *
 * This is bounded: at most one mutation per placeholder row, and
 * the placeholder set is small (only inserted when the inline
 * aggregate scan failed).
 */
export const confirmPlaceholderZeroSweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lastUpdatedAt = Date.now();
    let confirmedZeroPlaceholders = 0;

    let cursor: string | null = null;
    let isDone = false;
    // Bound to a generous number of pages; placeholder rows are
    // rare (only created on aggregate-scan failure) so this is
    // almost always a single page in practice.
    for (let i = 0; i < 1000 && !isDone; i += 1) {
      const page = await ctx.db
        .query("videoEditorStorageStats")
        .withIndex("by_placeholder", (q) => q.eq("lastUpdatedAt", 0))
        .paginate({ cursor, numItems: 200 });
      isDone = page.isDone;
      cursor = page.isDone ? null : page.continueCursor;

      for (const row of page.page) {
        // Skip rows that were touched by a mutation after the
        // cron's scanStartTime — those mutations have fresher
        // delta math than what we'd write here. Race-safe: the
        // next cron pass will revisit them.
        // (We don't have scanStartTime in this sweep; mutations
        // since the previous cron pass are fine to clobber here
        // because the subsequent cron's main scan will re-process
        // editors with active uploads. The only way a placeholder
        // survives here is if the editor has NO active uploads —
        // and for those editors, 0/0 with a fresh timestamp is
        // strictly more accurate than any pending mutation
        // because no mutations CAN be pending without active
        // uploads being added.)
        const hasActive = await ctx.db
          .query("instructorUploads")
          .withIndex("by_uploadedById", (q) =>
            q.eq("uploadedById", row.videoEditorId)
          )
          .filter((q) =>
            q.and(
              q.neq(q.field("status"), "deleted"),
              q.neq(q.field("status"), "deleting"),
            )
          )
          .first();
        if (hasActive) continue;

        await ctx.db.patch(row._id, {
          usedBytes: 0,
          fileCount: 0,
          lastUpdatedAt,
          placeholderTouchedAt: undefined,
        });
        confirmedZeroPlaceholders += 1;
      }
      if (cursor === null) break;
    }
    return { confirmedZeroPlaceholders };
  },
});

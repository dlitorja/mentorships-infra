"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

interface UploadsPage {
  rows: Array<{
    _id: string;
    uploadedById?: string;
    size: number;
    status: string;
  }>;
  isDone: boolean;
  nextCursor: string | null;
}

interface BatchResult {
  written: number;
  unchanged: number;
  skippedByMutation: number;
  reconciledPlaceholders: number;
}

interface PlaceholderConfirmationResult {
  confirmedZeroPlaceholders: number;
}

/**
 * Cron-driven backfill for the HUC-58 denormalized storage counter.
 *
 * Strategy: paginate `instructorUploads` via an internal query (so
 * each page stays under Convex's per-mutation read limit), accumulate
 * the per-editor aggregate in the action's memory across all pages,
 * then write the full aggregate in one mutation call at the end.
 *
 * Why accumulate in the action: if the mutation overwrote the
 * counter per page, an editor whose uploads span two pages would end
 * up with only the second page's subtotal (round-24 Greptile P1 #2).
 * Accumulating across pages guarantees the final value matches the
 * pre-counter scan.
 *
 * Second sweep: editors with a placeholder counter (`lastUpdatedAt:
 * 0`) but no active uploads were missed by the main scan (it only
 * accumulates editors with active rows). Their placeholder would
 * otherwise persist forever, leaving the "refreshing" badge visible
 * indefinitely even though 0/0 is the correct value. The sweep
 * queries counter rows with `lastUpdatedAt === 0`, confirms each has
 * no active uploads via a separate index lookup, then writes 0/0
 * with a real timestamp.
 *
 * The walk is resumable via cursor. The MAX_ITERATIONS bound
 * prevents runaway loops if the cursor were ever to repeat.
 */
const MAX_ITERATIONS = 10_000;

export const runBackfillVideoEditorStorageCounter = internalAction({
  args: {},
  handler: async (ctx) => {
    // Capture the scan start time BEFORE walking uploads. Any
    // mutation that updates a counter after this timestamp has
    // fresher data than our scan; the write below will skip those
    // rows. (Round-25 Greptile P1 #3.)
    const scanStartTime = Date.now();

    let cursor: string | null = null;
    let iterations = 0;
    let totalRowsScanned = 0;
    const aggregate = new Map<string, { usedBytes: number; fileCount: number }>();

    do {
      const page = (await ctx.runQuery(
        internal.mutations.backfillVideoEditorStorageCounter.getUploadsPage,
        { cursor }
      )) as UploadsPage;
      iterations += 1;
      totalRowsScanned += page.rows.length;
      for (const row of page.rows) {
        if (!row.uploadedById) continue;
        if (row.status === "deleted" || row.status === "deleting") continue;
        const existing = aggregate.get(row.uploadedById);
        if (existing) {
          existing.usedBytes += row.size;
          existing.fileCount += 1;
        } else {
          aggregate.set(row.uploadedById, { usedBytes: row.size, fileCount: 1 });
        }
      }
      cursor = page.nextCursor;
      if (page.isDone) break;
    } while (cursor !== null && iterations < MAX_ITERATIONS);

    // Write the full aggregate in one mutation. Convex mutations can
    // accept up to a few MB of args; for tens of thousands of editors
    // (extreme scale) this stays well under the limit.
    const entries = Array.from(aggregate.entries()).map(
      ([videoEditorId, agg]) => ({
        videoEditorId,
        usedBytes: agg.usedBytes,
        fileCount: agg.fileCount,
      })
    );
    const result = (await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.setVideoEditorStorageCounterBatch,
      { entries, scanStartTime }
    )) as BatchResult;

    // Second sweep: confirm zero on placeholders whose editors have
    // no active uploads. (Round-33 Greptile P2 #3.)
    const placeholderResult = (await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.confirmPlaceholderZeroSweep,
      {}
    )) as PlaceholderConfirmationResult;

    return {
      iterations,
      totalRowsScanned,
      editorsInAggregate: entries.length,
      editorsWritten: result.written,
      editorsUnchanged: result.unchanged,
      editorsSkippedByMutation: result.skippedByMutation ?? 0,
      editorsReconciledPlaceholders: result.reconciledPlaceholders ?? 0,
      editorsConfirmedZeroPlaceholders:
        placeholderResult.confirmedZeroPlaceholders,
      reachedMaxIterations: !cursor && iterations >= MAX_ITERATIONS,
    };
  },
});

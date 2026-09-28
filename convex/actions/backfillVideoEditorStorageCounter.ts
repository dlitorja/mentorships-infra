"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

interface BatchResult {
  rowsScanned: number;
  editorsWritten: number;
  editorsUnchanged: number;
  isDone: boolean;
  nextCursor: string | null;
}

/**
 * Cron-driven backfill that walks every `instructorUploads` row in
 * bounded batches and writes the per-editor aggregate to
 * `videoEditorStorageStats`. HUC-58.
 *
 * The batch size is set in
 * `convex/mutations/backfillVideoEditorStorageCounter.ts` so it
 * stays under Convex's per-mutation read limit (32k reads / mutation).
 *
 * The walk is resumable: each batch returns a `nextCursor` that the
 * action follows until the table is exhausted. The mutation is
 * idempotent (skips writes when the value is unchanged), so a cron
 * run that gets interrupted mid-walk can be re-driven without
 * double-counting.
 *
 * The MAX_ITERATIONS bound prevents runaway loops if the index
 * cursor were ever to repeat.
 */
const MAX_ITERATIONS = 1000;

export const runBackfillVideoEditorStorageCounter = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let iterations = 0;
    let totalRowsScanned = 0;
    let totalEditorsWritten = 0;
    let totalEditorsUnchanged = 0;
    let isDone = false;
    do {
      const result = (await ctx.runMutation(
        internal.mutations.backfillVideoEditorStorageCounter.backfillVideoEditorStorageCounterBatch,
        { cursor }
      )) as BatchResult;
      iterations += 1;
      totalRowsScanned += result.rowsScanned;
      totalEditorsWritten += result.editorsWritten;
      totalEditorsUnchanged += result.editorsUnchanged;
      isDone = result.isDone;
      cursor = result.nextCursor;
      if (isDone) break;
    } while (cursor !== null && iterations < MAX_ITERATIONS);
    return {
      iterations,
      totalRowsScanned,
      totalEditorsWritten,
      totalEditorsUnchanged,
      reachedMaxIterations: !isDone,
    };
  },
});

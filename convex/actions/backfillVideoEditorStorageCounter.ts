"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

interface BackfillResult {
  rowsScanned: number;
  editorsWritten: number;
}

/**
 * Cron entry point for the HUC-58 denormalized storage counter
 * backfill. Calls `backfillVideoEditorStorageCounterFull` which
 * scans every `instructorUploads` row in a single transaction,
 * aggregates active bytes per `uploadedById`, and writes the
 * results to `videoEditorStorageStats`.
 *
 * The full-scan approach is intentional:
 *   - One transaction means atomic snapshot consistency.
 *   - One read pass means O(N) total cost, not O(N × editors).
 *   - Idempotent: re-running rewrites the same values.
 *
 * The cron runs hourly. For typical prod scale (tens of thousands
 * of rows, hundreds of editors), the full scan completes in well
 * under the action timeout. The mutation is bounded by Convex's
 * per-mutation row-read limit (currently 32k reads per mutation);
 * for larger scales the action could be split into paginated
 * batches, but that adds complexity without current need.
 */
export const runBackfillVideoEditorStorageCounter = internalAction({
  args: {},
  handler: async (ctx): Promise<BackfillResult> => {
    const result = await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.backfillVideoEditorStorageCounterFull,
      {}
    );
    return result;
  },
});

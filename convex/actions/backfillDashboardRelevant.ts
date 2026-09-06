"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

const BATCH_SIZE = 500;

type BackfillBatchResult = {
  processed: number;
  updated: number;
  skipped: number;
  nextCursor: string | null;
  isDone: boolean;
};

export const runBackfillDashboardRelevant = internalAction({
  args: {},
  handler: async (ctx): Promise<{ iterations: number; lastStatus: BackfillBatchResult }> => {
    let iterations = 0;
    let cursor: string | null = null;
    let lastStatus: BackfillBatchResult | null = null;
    do {
      const result: BackfillBatchResult = await ctx.runMutation(
        internal.mutations.backfillDashboardRelevant.backfillDashboardRelevantBatch,
        { cursor, batchSize: BATCH_SIZE }
      );
      iterations++;
      cursor = result.nextCursor;
      lastStatus = result;
      if (result.isDone) break;
    } while (cursor !== null && iterations < 10_000);
    return { iterations, lastStatus: lastStatus as BackfillBatchResult };
  },
});

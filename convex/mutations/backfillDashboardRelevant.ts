import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { isDashboardRelevant } from "./suppressionEvents";

export const backfillDashboardRelevantBatch = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    batchSize: v.number(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("suppressionEvents")
      .paginate({ cursor: args.cursor, numItems: args.batchSize });

    let updated = 0;
    let skipped = 0;
    for (const row of results.page) {
      const desired = isDashboardRelevant(row.resendId, row.kind);
      if (row.dashboardRelevant === desired) {
        skipped++;
        continue;
      }
      await ctx.db.patch(row._id, { dashboardRelevant: desired });
      updated++;
    }

    return {
      processed: results.page.length,
      updated,
      skipped,
      nextCursor: results.isDone ? null : results.continueCursor,
      isDone: results.isDone,
    };
  },
});

export const backfillDashboardRelevantStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const total = await ctx.db.query("suppressionEvents").collect();
    const withFlag = total.filter((r) => typeof r.dashboardRelevant === "boolean");
    return {
      totalRows: total.length,
      withFlag: withFlag.length,
      remaining: total.length - withFlag.length,
    };
  },
});

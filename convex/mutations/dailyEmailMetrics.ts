import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const dailyEmailMetricRow = v.object({
  date: v.string(),
  audienceId: v.optional(v.string()),
  kind: v.union(
    v.literal("bounce"),
    v.literal("complaint"),
    v.literal("delivery"),
    v.literal("open"),
    v.literal("click")
  ),
  count: v.number(),
  source: v.union(v.literal("api"), v.literal("webhook_reconcile")),
  ingestedAt: v.number(),
});

export const upsertDailyMetrics = internalMutation({
  args: { rows: v.array(dailyEmailMetricRow) },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("dailyEmailMetrics")
        .withIndex("by_date_and_audienceId_and_kind", (q) =>
          q.eq("date", row.date).eq("audienceId", row.audienceId).eq("kind", row.kind)
        )
        .first();
      if (existing) {
        if (existing.count !== row.count || existing.source !== row.source) {
          await ctx.db.patch(existing._id, {
            count: row.count,
            source: row.source,
            ingestedAt: row.ingestedAt,
          });
          updated++;
        } else {
          unchanged++;
        }
      } else {
        await ctx.db.insert("dailyEmailMetrics", row);
        inserted++;
      }
    }
    return { inserted, updated, unchanged, total: args.rows.length };
  },
});

export type DailyEmailMetricRow = {
  date: string;
  audienceId?: string;
  kind: "bounce" | "complaint" | "delivery" | "open" | "click";
  count: number;
  source: "api" | "webhook_reconcile";
  ingestedAt: number;
};

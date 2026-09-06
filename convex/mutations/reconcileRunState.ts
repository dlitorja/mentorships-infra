import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const RECONCILE_MIN_INTERVAL_MS = 30 * 60 * 1000;

export const tryStartReconcile = internalMutation({
  args: {
    runStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("reconcileRunState").first();
    if (existing) {
      const elapsed = args.runStartedAt - existing.lastStartedAt;
      if (elapsed < RECONCILE_MIN_INTERVAL_MS) {
        return {
          acquired: false as const,
          reason: "another_recent_reconcile" as const,
          previousStartedAt: existing.lastStartedAt,
        };
      }
      await ctx.db.patch(existing._id, { lastStartedAt: args.runStartedAt });
      return {
        acquired: true as const,
        previousStartedAt: existing.lastStartedAt,
      };
    }
    await ctx.db.insert("reconcileRunState", { lastStartedAt: args.runStartedAt });
    return { acquired: true as const, previousStartedAt: null };
  },
});

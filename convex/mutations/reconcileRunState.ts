import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const RECONCILE_MIN_INTERVAL_MS = 30 * 60 * 1000;
const STALE_RUN_MS = 60 * 60 * 1000;

export const tryStartReconcile = internalMutation({
  args: {
    runStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("reconcileRunState").first();
    if (existing) {
      if (existing.currentRunStartedAt !== undefined) {
        const inProgressAge = args.runStartedAt - existing.currentRunStartedAt;
        if (inProgressAge > STALE_RUN_MS) {
          await ctx.db.patch(existing._id, {
            currentRunStartedAt: args.runStartedAt,
            lastStartedAt: args.runStartedAt,
          });
          return {
            acquired: true as const,
            staleRecovered: true as const,
            currentRunStartedAt: args.runStartedAt,
            previousStartedAt: existing.lastStartedAt,
          };
        }
        return {
          acquired: false as const,
          reason: "reconcile_in_progress" as const,
          currentRunStartedAt: existing.currentRunStartedAt,
          previousStartedAt: existing.lastStartedAt,
        };
      }
      const elapsed = args.runStartedAt - existing.lastStartedAt;
      if (elapsed < RECONCILE_MIN_INTERVAL_MS) {
        return {
          acquired: false as const,
          reason: "another_recent_reconcile" as const,
          currentRunStartedAt: null,
          previousStartedAt: existing.lastStartedAt,
        };
      }
      await ctx.db.patch(existing._id, {
        currentRunStartedAt: args.runStartedAt,
        lastStartedAt: args.runStartedAt,
      });
      return {
        acquired: true as const,
        currentRunStartedAt: args.runStartedAt,
        previousStartedAt: existing.lastStartedAt,
      };
    }
    await ctx.db.insert("reconcileRunState", {
      currentRunStartedAt: args.runStartedAt,
      lastStartedAt: args.runStartedAt,
    });
    return {
      acquired: true as const,
      currentRunStartedAt: args.runStartedAt,
      previousStartedAt: null,
    };
  },
});

export const markReconcileCompleted = internalMutation({
  args: {
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("reconcileRunState").first();
    if (!existing) return { found: false };
    await ctx.db.patch(existing._id, {
      currentRunStartedAt: undefined,
      lastCompletedAt: args.completedAt,
    });
    return { found: true };
  },
});

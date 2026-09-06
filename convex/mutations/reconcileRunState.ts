import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

const RECONCILE_MIN_INTERVAL_MS = 30 * 60 * 1000;
const STALE_RUN_MS = 60 * 60 * 1000;

function generateRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const tryStartReconcile = internalMutation({
  args: {
    runStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const runId = generateRunId();
    const existing = await ctx.db.query("reconcileRunState").first();
    if (existing) {
      if (existing.currentRunStartedAt !== undefined) {
        const inProgressAge = args.runStartedAt - existing.currentRunStartedAt;
        if (inProgressAge > STALE_RUN_MS) {
          await ctx.db.patch(existing._id, {
            currentRunStartedAt: args.runStartedAt,
            currentRunId: runId,
            lastStartedAt: args.runStartedAt,
          });
          return {
            acquired: true as const,
            staleRecovered: true as const,
            runId,
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
        currentRunId: runId,
        lastStartedAt: args.runStartedAt,
      });
      return {
        acquired: true as const,
        runId,
        currentRunStartedAt: args.runStartedAt,
        previousStartedAt: existing.lastStartedAt,
      };
    }
    await ctx.db.insert("reconcileRunState", {
      currentRunStartedAt: args.runStartedAt,
      currentRunId: runId,
      lastStartedAt: args.runStartedAt,
    });
    return {
      acquired: true as const,
      runId,
      currentRunStartedAt: args.runStartedAt,
      previousStartedAt: null,
    };
  },
});

export const isCurrentRun = internalQuery({
  args: {
    runStartedAt: v.number(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("reconcileRunState").first();
    if (!existing) return { current: false, reason: "no_state" as const };
    if (existing.currentRunStartedAt === undefined) {
      return { current: false, reason: "no_active_run" as const };
    }
    if (existing.currentRunStartedAt !== args.runStartedAt) {
      return { current: false, reason: "superseded" as const };
    }
    if (existing.currentRunId !== args.runId) {
      return { current: false, reason: "id_mismatch" as const };
    }
    return { current: true, reason: "match" as const };
  },
});

export const markReconcileCompleted = internalMutation({
  args: {
    completedAt: v.number(),
    runStartedAt: v.number(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("reconcileRunState").first();
    if (!existing) return { found: false, cleared: false };
    if (existing.currentRunStartedAt !== args.runStartedAt) {
      return { found: true, cleared: false, reason: "superseded" as const };
    }
    if (existing.currentRunId !== args.runId) {
      return { found: true, cleared: false, reason: "id_mismatch" as const };
    }
    await ctx.db.patch(existing._id, {
      currentRunStartedAt: undefined,
      currentRunId: undefined,
      lastCompletedAt: args.completedAt,
    });
    return { found: true, cleared: true };
  },
});

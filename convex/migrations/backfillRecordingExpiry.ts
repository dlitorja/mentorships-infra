import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";

const DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

/**
 * R12: one-shot backfill that stamps `recordingExpiresAt` on
 * every existing `sessions` row that has a B2 recording but no
 * expiry. Each row gets `_creationTime + 90d` (the legacy
 * default) so the cleanup schedule picks them up uniformly
 * with newly-stamped rows.
 *
 * Idempotent: rows with `recordingExpiresAt !== undefined`
 * are skipped. Safe to re-run after a partial failure.
 *
 * Why a separate mutation instead of inlining in
 * `convex/migrations.ts`: this is also exposed as a Trigger
 * schedule (`backfill-recording-expiry`) so the operator can
 * fire it from the Trigger dashboard without shelling out to
 * the Convex CLI. Keeping it standalone lets both paths share
 * the same code.
 *
 * Designed to use `ctx.scheduler.runAfter` to re-invoke
 * itself with a cursor until the query returns empty — see
 * Convex guideline "mutations are transactions with limits on
 * the number of documents read and written".
 */
export const backfillRecordingExpiryStep = internalMutation({
  args: { cursor: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const start = args.cursor ?? 0;
    const candidates = await ctx.db
      .query("sessions")
      .order("asc")
      .take(BATCH_SIZE);

    let updated = 0;
    let lastId: number | null = null;
    let nextCursor: number | null = null;

    for (const s of candidates) {
      lastId = s._creationTime;
      if (s._creationTime < start) continue;
      if (s.recordingExpiresAt !== undefined) continue;
      if (s.recordingUrl === undefined) continue;
      if (s.deletedAt !== undefined) continue;

      await ctx.db.patch(s._id, {
        recordingExpiresAt: s._creationTime + DEFAULT_RETENTION_MS,
      });
      updated++;
    }

    // If we processed the full batch, schedule the next batch.
    if (candidates.length === BATCH_SIZE && lastId !== null) {
      nextCursor = lastId + 1;
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillRecordingExpiry.backfillRecordingExpiryStep,
        { cursor: nextCursor }
      );
    }

    return { updated, processed: candidates.length, nextCursor };
  },
});

/**
 * Returns a quick count of sessions that still need the
 * expiry backfill. Useful for the Trigger task to log
 * progress and for the operator to know if a re-run is
 * needed.
 */
export const countSessionsNeedingExpiry = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sessions").collect();
    return all.filter(
      (s) =>
        s.deletedAt === undefined &&
        s.recordingUrl !== undefined &&
        s.recordingExpiresAt === undefined
    ).length;
  },
});

/**
 * Public-facing action wrapper for the Convex CLI:
 *   npx convex run migrations/backfillRecordingExpiry:runBackfill '{}'
 */
export const runBackfill = internalAction({
  args: {},
  handler: async (ctx): Promise<{ started: boolean; remaining: number }> => {
    const remaining: number = await ctx.runQuery(
      internal.migrations.backfillRecordingExpiry.countSessionsNeedingExpiry,
      {}
    );
    if (remaining === 0) {
      return { started: false, remaining };
    }
    await ctx.runMutation(
      internal.migrations.backfillRecordingExpiry.backfillRecordingExpiryStep,
      { cursor: 0 }
    );
    return { started: true, remaining };
  },
});

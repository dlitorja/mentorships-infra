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
 *
 * Greptile P1 (fix): switched from `.take(BATCH_SIZE)` +
 * `_creationTime` cursor to Convex's native `.paginate()`
 * with `paginationOpts`. The previous implementation re-read
 * the same first 100 rows on every invocation because `.take`
 * ignores any client-side cursor and `s._creationTime < start`
 * skipped everything — the migration would have stalled after
 * batch 1 leaving rows 101+ un-stamped.
 */
export const backfillRecordingExpiryStep = internalMutation({
  args: { paginationOpts: v.any() },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("sessions")
      .order("asc")
      .paginate(args.paginationOpts);

    let updated = 0;
    for (const s of result.page) {
      if (s.recordingExpiresAt !== undefined) continue;
      if (s.recordingUrl === undefined) continue;
      if (s.deletedAt !== undefined) continue;

      await ctx.db.patch(s._id, {
        recordingExpiresAt: s._creationTime + DEFAULT_RETENTION_MS,
      });
      updated++;
    }

    // If the page was full and Convex says there's more, schedule
    // the next batch with the returned `continueCursor`. Convex
    // pages are bounded by `numItems` so we read up to
    // BATCH_SIZE rows per invocation and re-invoke with the next
    // cursor. We bail if the page was smaller than `numItems`
    // (drain complete) or if `isDone` is true (Convex has no
    // more rows to return).
    if (!result.isDone && result.page.length >= BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillRecordingExpiry.backfillRecordingExpiryStep,
        {
          paginationOpts: {
            numItems: BATCH_SIZE,
            cursor: result.continueCursor,
          },
        }
      );
    }

    return {
      updated,
      processed: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
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
      { paginationOpts: { numItems: BATCH_SIZE, cursor: null } }
    );
    return { started: true, remaining };
  },
});

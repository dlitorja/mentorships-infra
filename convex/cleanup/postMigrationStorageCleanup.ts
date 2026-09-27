import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { BACKFILL_GRACE_MS } from "../workspaceConstants";

/**
 * PR workspace-storage-3a (post-migration Convex-storage cleanup):
 * daily cron that deletes the Convex Storage blob at `storageId`
 * for `fileUploads` rows whose `migratedAt` settled more than
 * `BACKFILL_GRACE_MS` (7 days) ago AND that have no live references
 * in `workspaceMessages` / `workspaceImages` /
 * `workspaceNoteComments` / `instructorResources`.
 *
 * Why: Convex Storage is on the free-plan tier (1 GB total). PR 2
 * (migrate) copies every legacy blob to B2 but does NOT delete the
 * original. PR 3a's cron frees the Convex Storage bytes once the
 * B2 copy has been verified + retained for a grace window (matches
 * `BACKFILL_GRACE_MS` so a fresh migration is not at risk of being
 * cleaned up before users see the new path).
 *
 * Safety:
 *   - The `by_migratedAt_uploadedAt` index on `fileUploads` plus the
 *     `migratedAt >= now - 7d` range query excludes un-migrated rows
 *     and rows whose migration is still settling.
 *   - The post-filter drops `cancelledAt !== undefined` rows
 *     (rejected uploads — already cleaned up by their own path).
 *   - The live-ref check across the four referencing tables mirrors
 *     `chatFileRetention.findLiveStorageReferences` so a gallery
 *     image, an active resource, a non-deleted chat message, or a
 *     non-deleted note comment keeps the blob alive.
 *   - The `convexStorageBlobsDeletedAt` field is set as an
 *     idempotency guard — the candidate query excludes rows with
 *     it set, so re-runs are no-ops.
 *
 * `ctx.storage.delete` is best-effort and idempotent: if the blob
 * is already gone (e.g., another sweep raced), the call is a no-op
 * and we still mark the ledger so future runs skip the row.
 *
 * Cron runs daily (`convex/crons.ts`); the index makes the
 * candidate lookup cheap. We page in batches of 50 rows so a
 * large backlog drains in a single tick but each tick's runtime
 * stays bounded.
 */

const BATCH_SIZE = 50;

/**
 * Soft upper bound on a single cron tick — runtime budgets are
 * generous but not infinite, so we cap a tick at ~12k rows so a
 * sudden spike (e.g. backfill just landed) cannot exhaust the
 * tick budget. PR 3b / 3c will tune this once we observe real
 * B2 migration throughput.
 */
const MAX_CANDIDATES_PER_TICK = 12_000;

/**
 * Returns up to `limit` `fileUploads` rows whose `migratedAt` is
 * set and at least `BACKFILL_GRACE_MS` old AND whose B2 copy has
 * been finalized (`b2Key` and `completedAt` set) AND that have
 * not been cleaned up by a previous tick (`convexStorageBlobsDeletedAt`
 * is undefined). Cancellation rows are excluded; they were
 * already cleaned up by the `cancelB2FileUpload` path.
 *
 * Uses the `by_migratedAt_uploadedAt` index so the cross-workspace
 * scan does not exceed Convex's read budget. The `q.gt("migratedAt",
 * 0)` filter excludes rows where `migratedAt` is undefined (Convex
 * indexes store undefined as null, which sorts below all positive
 * numbers). The post-filter then drops the `b2Key` / `storageId`
 * / `cancelledAt` / `convexStorageBlobsDeletedAt` carve-outs and
 * applies the real age threshold `migratedAt < threshold` (the
 * index cannot express a `<` filter directly because Convex
 * indexes require equality on leftmost columns).
 */
export const listCleanupCandidates = internalQuery({
  args: {
    threshold: v.number(),
    limit: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("fileUploads")
      .withIndex("by_migratedAt_uploadedAt", (q) =>
        q.gt("migratedAt", 0)
      )
      .paginate({ numItems: args.limit, cursor: args.cursor ?? "" });
    const filtered = page.page.filter(
      (row) =>
        row.migratedAt !== undefined &&
        row.migratedAt < args.threshold &&
        row.b2Key !== undefined &&
        row.storageId !== undefined &&
        row.cancelledAt === undefined &&
        row.convexStorageBlobsDeletedAt === undefined &&
        row.completedAt !== undefined
    );
    return {
      rows: filtered,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Mirrors `chatFileRetention.findLiveStorageReferences` plus
 * `workspaceNoteComments`. Returns the IDs of any non-deleted
 * rows that still reference this `storageId` — if any of the
 * four slots is non-null, the blob must stay alive.
 *
 * All four queries use the `by_storageId` index added in
 * PR 3a (workspaceNoteComments.index("by_storageId")). The
 * filter `q.eq(field("deletedAt"), undefined)` selects rows
 * whose soft-delete is unset (Convex indexes undefined
 * values together, so the equality matches absent fields).
 */
export const findLiveStorageReferencesForCleanup = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (
    ctx,
    args
  ): Promise<{
    imageId: Id<"workspaceImages"> | null;
    resourceId: Id<"instructorResources"> | null;
    chatMessageId: Id<"workspaceMessages"> | null;
    noteCommentId: Id<"workspaceNoteComments"> | null;
  }> => {
    const image = await ctx.db
      .query("workspaceImages")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    const resource = await ctx.db
      .query("instructorResources")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    const chatMessage = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    const noteComment = await ctx.db
      .query("workspaceNoteComments")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    return {
      imageId: image ? image._id : null,
      resourceId: resource ? resource._id : null,
      chatMessageId: chatMessage ? chatMessage._id : null,
      noteCommentId: noteComment ? noteComment._id : null,
    };
  },
});

/**
 * Atomically marks a row as cleaned-up. Idempotent: a second call
 * with the same `fileUploadId` returns `{ marked: false }` so the
 * orchestrator does not double-count. The CAS predicate
 * (`convexStorageBlobsDeletedAt === undefined`) prevents a
 * concurrent sweep tick from double-stamping a row whose blob
 * was just deleted.
 */
export const markConvexStorageBlobDeleted = internalMutation({
  args: {
    fileUploadId: v.id("fileUploads"),
    deletedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fileUploadId);
    if (!row) {
      return { marked: false };
    }
    if (row.convexStorageBlobsDeletedAt !== undefined) {
      return { marked: false };
    }
    await ctx.db.patch(args.fileUploadId, {
      convexStorageBlobsDeletedAt: args.deletedAt,
    });
    return { marked: true };
  },
});

/**
 * PR workspace-storage-3a cron entry point. Scans
 * `fileUploads` for migrated rows whose Convex Storage blob is
 * eligible for deletion (see `listCleanupCandidates` criteria),
 * checks each for live references across the four referencing
 * tables, and deletes the blob if none remain.
 *
 * Returns counts for observability. The Trigger.dev task runner
 * (none today — Convex cron is sufficient for daily cadence) would
 * pick these up from the action's return value.
 */
export const cleanupMigratedConvexStorageBlobs = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    scanned: number;
    deletedBlobs: number;
    skippedLiveRefs: number;
    skippedAlreadyDeleted: number;
    skippedOrphan: number;
    errors: string[];
  }> => {
    const threshold = Date.now() - BACKFILL_GRACE_MS;

    let totalScanned = 0;
    let totalDeletedBlobs = 0;
    let totalSkippedLiveRefs = 0;
    let totalSkippedAlreadyDeleted = 0;
    let totalSkippedOrphan = 0;
    const errors: string[] = [];

    let cursor: string | null = null;
    while (totalScanned < MAX_CANDIDATES_PER_TICK) {
      const page: {
        rows: Array<{
          _id: Id<"fileUploads">;
          storageId: Id<"_storage">;
          b2Key: string | undefined;
          migratedAt: number | undefined;
        }>;
        cursor: string | null;
      } = await ctx.runQuery(
        internal.cleanup.postMigrationStorageCleanup.listCleanupCandidates,
        { threshold, limit: BATCH_SIZE, cursor }
      );
      if (page.rows.length === 0) break;
      totalScanned += page.rows.length;

      for (const row of page.rows) {
        const refs = await ctx.runQuery(
          internal.cleanup.postMigrationStorageCleanup
            .findLiveStorageReferencesForCleanup,
          { storageId: row.storageId }
        );
        if (
          refs.imageId !== null ||
          refs.resourceId !== null ||
          refs.chatMessageId !== null ||
          refs.noteCommentId !== null
        ) {
          totalSkippedLiveRefs++;
          continue;
        }
        // CAS-mark before deleting so a concurrent tick sees the
        // candidate row filtered out at the next iteration. The
        // candidate query's post-filter will catch this on the
        // next page-load even without the CAS, but the CAS gives
        // us a stricter no-double-delete guarantee when two ticks
        // race on the same row.
        const stamp = await ctx.runMutation(
          internal.cleanup.postMigrationStorageCleanup
            .markConvexStorageBlobDeleted,
          { fileUploadId: row._id, deletedAt: Date.now() }
        );
        if (!stamp.marked) {
          totalSkippedAlreadyDeleted++;
          continue;
        }
        // `ctx.storage.delete` is action-only and best-effort: if
        // the blob is already gone (orphan ledger row, or a
        // concurrent tick beat us), the call no-ops. We still
        // keep the CAS mark so future ticks skip the row.
        try {
          await ctx.storage.delete(row.storageId);
          totalDeletedBlobs++;
        } catch (e) {
          // Convex Storage `delete` does not throw in practice
          // (the API is best-effort), but we surface any error so
          // operators can investigate. The CAS mark stays so the
          // row is not retried on the next tick — a future PR can
          // clear the mark if manual intervention is needed.
          errors.push(
            `Failed to delete storage ${row.storageId} for ledger ${row._id}: ${(e as Error).message}`
          );
        }
      }

      cursor = page.cursor;
      if (cursor === null) break;
    }

    return {
      scanned: totalScanned,
      deletedBlobs: totalDeletedBlobs,
      skippedLiveRefs: totalSkippedLiveRefs,
      skippedAlreadyDeleted: totalSkippedAlreadyDeleted,
      skippedOrphan: totalSkippedOrphan,
      errors,
    };
  },
});

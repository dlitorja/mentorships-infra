import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { Doc } from "../_generated/dataModel";
import { CHAT_FILE_RETENTION_MS } from "../workspaceConstants";

/**
 * PR workspace-storage-3a (post-migration Convex-storage cleanup):
 * daily cron that deletes the Convex Storage blob at `storageId`
 * for `fileUploads` rows whose `migratedAt` settled more than
 * `CHAT_FILE_RETENTION_MS` (30 days) ago AND that have no live
 * references in `workspaceMessages` / `workspaceImages` /
 * `workspaceNoteComments` / `instructorResources`.
 *
 * Why: Convex Storage is on the free-plan tier (1 GB total). PR 2
 * (migrate) copies every legacy blob to B2 but does NOT delete the
 * original. PR 3a's cron frees the Convex Storage bytes once the
 * B2 copy has been verified + retained for a grace window.
 *
 * The threshold is `CHAT_FILE_RETENTION_MS` (not the smaller
 * `BACKFILL_GRACE_MS`) because `workspaceMessages` has a 30-day
 * admin-restore window: a soft-deleted chat file can be restored
 * up to 30 days after deletion. The chat retention cron
 * (`hardDeleteExpiredChatFiles`) hard-deletes the row after that
 * window closes, after which no restore is possible. Picking a
 * smaller threshold would let our cron delete the legacy Convex
 * blob while a chat message still references it via the soft-
 * deleted row, exposing a 404 download URL if an admin restores
 * the message. (Greptile P1: "Restored files lose their blobs".)
 *
 * For the non-chat referencing tables (workspaceImages,
 * workspaceNoteComments, instructorResources) there is no soft-
 * delete grace period — they hard-delete directly, so the 30-day
 * threshold is safe but conservative. PR 3c may tighten this once
 * the cutover flag flips and B2 becomes the source of truth.
 *
 * Safety:
 *   - The `by_migratedAt_uploadedAt` index on `fileUploads` plus
 *     the `q.gt("migratedAt", 0)` range query excludes un-migrated
 *     rows and rows whose migration is still settling. The post-
 *     filter then applies the real age threshold
 *     `migratedAt < threshold` because Convex indexes cannot
 *     express a `<` filter directly.
 *   - The post-filter drops `cancelledAt !== undefined` rows
 *     (rejected uploads — already cleaned up by their own path)
 *     and `convexStorageBlobsDeletedAt !== undefined` rows
 *     (already cleaned by a previous tick — idempotency guard).
 *   - The live-ref check across the four referencing tables
 *     mirrors `chatFileRetention.findLiveStorageReferences` so a
 *     gallery image, an active resource, a non-deleted chat
 *     message, or a non-deleted note comment keeps the blob
 *     alive. The `q.eq(field("deletedAt"), undefined)` filter
 *     treats soft-deleted rows as not-live, which is correct:
 *     once the chat retention cron hard-deletes them, the row
 *     is gone; until then, the soft-delete window has not
 *     expired and the blob must stay alive in case of restore.
 *   - The ledger field `convexStorageBlobsDeletedAt` is written
 *     AFTER `ctx.storage.delete` succeeds. A failed delete does
 *     NOT stamp the row, so the next tick re-runs the cleanup
 *     for that row. (Greptile P1: "Failed deletes cannot retry".)
 *   - Pagination terminates on `page.cursor === null` (end of
 *     index), NOT on `page.rows.length === 0` (filtered-empty
 *     page). Stamped rows remain at the front of the index; if
 *     we broke on empty filtered pages, we would never advance
 *     past them. (Greptile P1: "Empty pages stop cleanup".)
 *   - `MAX_BATCHES_PER_TICK` caps the number of index pages a
 *     single tick can read, so a sparse-data backlog cannot
 *     exhaust the action runtime budget.
 *
 * `ctx.storage.delete` is best-effort and idempotent: if the blob
 * is already gone (e.g., a prior tick raced), the call no-ops and
 * the row is still stamped.
 *
 * Cron runs daily (`convex/crons.ts`); the index makes the
 * candidate lookup cheap. We page in batches of 50 rows so a
 * large backlog drains across a bounded number of ticks while
 * each tick's runtime stays bounded.
 */

const BATCH_SIZE = 50;

/**
 * Soft upper bound on candidates processed in a single cron tick.
 * Runtime budgets are generous but not infinite, so we cap a tick
 * at ~12k candidates so a sudden spike (e.g. backfill just landed)
 * cannot exhaust the tick budget. PR 3b / 3c will tune this once
 * we observe real B2 migration throughput.
 */
const MAX_CANDIDATES_PER_TICK = 12_000;

/**
 * Hard upper bound on index pages read in a single cron tick.
 * After the candidate query's post-filter drops stamped rows, the
 * orchestrator may need to scan many more pages than there are
 * candidates. This cap protects against a sparse-data backlog
 * (e.g. 100k migrated rows but only 100 candidates) exhausting
 * the action runtime budget before reaching later eligible rows.
 * 250 batches × 50 rows per batch = 12,500 index rows per tick.
 */
const MAX_BATCHES_PER_TICK = 250;

/**
 * Returns up to `limit` `fileUploads` rows whose `migratedAt` is
 * set and at least `CHAT_FILE_RETENTION_MS` old AND whose B2 copy
 * has been finalized (`b2Key` and `completedAt` set) AND that
 * have not been cleaned up by a previous tick
 * (`convexStorageBlobsDeletedAt` is undefined). Cancellation rows
 * are excluded; they were already cleaned up by the
 * `cancelB2FileUpload` path.
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
      .withIndex(
        "by_convexStorageBlobsDeletedAt_migratedAt_uploadedAt",
        (q) =>
          q
            .eq("convexStorageBlobsDeletedAt", undefined)
            .gt("migratedAt", 0)
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
 * Returns the IDs of any rows that still reference this
 * `storageId` — if any of the four slots is non-null, the blob
 * must stay alive.
 *
 * All four queries are intentionally UNFILTERED on `deletedAt`.
 * The reasoning for each table:
 *   - `workspaceMessages`: a soft-deleted message can be admin-
 *     restored for `CHAT_FILE_RETENTION_MS` (30 days); the chat
 *     retention cron hard-deletes the row after that window
 *     closes. We include soft-deleted messages so the blob stays
 *     alive until chat retention removes the row. (Greptile P1:
 *     "Restored files lose their blobs".)
 *   - `workspaceImages`: the gallery image's Convex URL may be
 *     embedded directly in `workspaceNotes.content` — that URL
 *     is not indexable, so we cannot tell from a query whether
 *     an active note still references a soft-deleted image.
 *     Including soft-deleted rows is conservative and matches
 *     the principle that a soft-deleted row's blob stays alive
 *     until the row is hard-deleted. (Greptile P1: "Notes lose
 *     embedded images".) The schema does not currently hard-
 *     delete gallery images, so soft-deleted image blobs stay
 *     alive forever by design — PR 3a only cleans orphan blobs.
 *   - `instructorResources`: \`storageId\` is required and the
 *     delete mutation hard-deletes the row. Including soft-
 *     deleted rows is harmless (there are none in practice)
 *     and removes a redundant filter.
 *   - `workspaceNoteComments`: a soft-deleted comment's image
 *     may still be visible to the note author via the note's
 *     rendered markdown (the comment's content is text, but the
 *     attached image's URL is rendered alongside). Including
 *     soft-deleted rows is conservative; PR 3a leaves their
 *     blobs alone by design.
 *
 * All four queries use the \`by_storageId\` index added in
 * PR 3a (workspaceNoteComments.index("by_storageId")).
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
      .first();
    const resource = await ctx.db
      .query("instructorResources")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    const chatMessage = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    const noteComment = await ctx.db
      .query("workspaceNoteComments")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
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
 * (`convexStorageBlobsDeletedAt === undefined`) catches a
 * concurrent tick that already stamped the row.
 *
 * Called AFTER `ctx.storage.delete` succeeds so a failed delete
 * leaves the row un-stamped and the next tick retries.
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
    const threshold = Date.now() - CHAT_FILE_RETENTION_MS;

    let totalScanned = 0;
    let totalDeletedBlobs = 0;
    let totalSkippedLiveRefs = 0;
    let totalSkippedAlreadyDeleted = 0;
    let totalSkippedOrphan = 0;
    let batchesProcessed = 0;
    const errors: string[] = [];

    let cursor: string | null = null;
    while (
      totalScanned < MAX_CANDIDATES_PER_TICK &&
      batchesProcessed < MAX_BATCHES_PER_TICK
    ) {
      const page: {
        rows: Doc<"fileUploads">[];
        cursor: string | null;
      } = await ctx.runQuery(
        internal.cleanup.postMigrationStorageCleanup.listCleanupCandidates,
        { threshold, limit: BATCH_SIZE, cursor }
      );
      batchesProcessed++;
      totalScanned += page.rows.length;

      for (const row of page.rows) {
        // The candidate query's post-filter guarantees
        // `storageId !== undefined`, but the schema field is
        // optional so TS sees it as `Id | undefined`. Narrow
        // before using it in calls that require a strict Id.
        const storageId = row.storageId;
        if (storageId === undefined) {
          totalSkippedOrphan++;
          continue;
        }
        const refs = await ctx.runQuery(
          internal.cleanup.postMigrationStorageCleanup
            .findLiveStorageReferencesForCleanup,
          { storageId }
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
        // `ctx.storage.delete` is action-only and best-effort:
        // if the blob is already gone (orphan ledger row, or a
        // concurrent tick beat us), the call no-ops. If it
        // throws, we leave the row un-stamped so the next tick
        // retries. (Greptile P1: "Failed deletes cannot retry".)
        try {
          await ctx.storage.delete(storageId);
        } catch (e) {
          errors.push(
            `Failed to delete storage ${storageId} for ledger ${row._id}: ${(e as Error).message}`
          );
          continue;
        }
        const stamp = await ctx.runMutation(
          internal.cleanup.postMigrationStorageCleanup
            .markConvexStorageBlobDeleted,
          { fileUploadId: row._id, deletedAt: Date.now() }
        );
        if (!stamp.marked) {
          // A concurrent tick already stamped this row. The blob
          // is gone (idempotent delete) and the ledger is set —
          // count it as already-handled to keep our observability
          // accurate.
          totalSkippedAlreadyDeleted++;
          continue;
        }
        totalDeletedBlobs++;
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

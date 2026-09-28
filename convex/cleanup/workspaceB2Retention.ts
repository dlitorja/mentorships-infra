import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { WORKSPACE_RETENTION_MS } from "../workspaceConstants";

/**
 * PR workspace-storage-3c (Greptile round 4 P1 fix — confidence
 * 0/5, "Lifecycle deletes referenced objects"): hard-delete
 * `fileUploads` rows whose upload completed more than
 * `WORKSPACE_RETENTION_MS` (18 months) ago AND have no live
 * references in `workspaceMessages` / `workspaceImages` /
 * `workspaceNoteComments` / `instructorResources`. This cron is
 * the SOLE source of truth for retention enforcement — the
 * earlier companion B2 lifecycle rule
 * (`scripts/set-b2-bucket-lifecycle.ts`, removed in PR 3c
 * round 4) is intentionally NOT applied. B2's lifecycle rule
 * operates on objects, not references, so a row whose
 * `completedAt` is past the retention window could be deleted
 * before the cron has had a chance to read its live references
 * — leaving the gallery / chat / notes tab pointing at a
 * missing object. Trusting the cron alone trades a small
 * storage-cost growth for guaranteed correctness.
 *
 * Retention math: 18 months past the original upload's
 * `completedAt`. NOT past `endedAt` of the workspace (the chat
 * retention cron already enforces a separate 30-day soft-delete
 * window on `workspaceMessages`). A workspace can be re-used
 * many years after its first upload, so anchoring retention to
 * `completedAt` lets long-lived workspaces age out their old
 * images without invalidating newer ones.
 *
 * Idempotency:
 *   - The ledger field `retentionDeletedAt` is written AFTER
 *     `deleteFromB2WorkspaceAction` succeeds (404 also counts
 *     as success — the object is already gone). A failed delete
 *     leaves the row un-stamped and the next tick retries.
 *   - Pagination terminates on `page.cursor === null` (end of
 *     index), NOT on `page.rows.length === 0` (filtered-empty
 *     page). Stamped rows remain at the front of the index; if
 *     we broke on empty filtered pages, we would never advance
 *     past them.
 *
 * Cron runs daily (`convex/crons.ts`).
 */

const BATCH_SIZE = 50;
/** Soft upper bound on candidates processed in a single cron tick. */
const MAX_CANDIDATES_PER_TICK = 12_000;
/** Hard upper bound on index pages read in a single cron tick. */
const MAX_BATCHES_PER_TICK = 250;

/**
 * Returns up to `limit` `fileUploads` rows whose `completedAt`
 * is older than `threshold` AND whose B2 copy exists (`b2Key`
 * set) AND whose ledger has NOT been stamped by this cron yet
 * (`retentionDeletedAt === undefined`). Cancellation rows are
 * excluded; the orphan-sweep cron owns those.
 *
 * Uses the `by_retentionDeletedAt_completedAt` index so stamped
 * rows are excluded from the scan entirely (otherwise each tick
 * would burn through its batch budget on already-cleaned rows).
 */
export const listRetentionCandidates = internalQuery({
  args: {
    threshold: v.number(),
    limit: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("fileUploads")
      .withIndex(
        "by_retentionDeletedAt_completedAt",
        (q) =>
          q
            .eq("retentionDeletedAt", undefined)
            .gt("completedAt", 0)
      )
      .paginate({ numItems: args.limit, cursor: args.cursor ?? "" });
    const filtered = page.page.filter(
      (row) =>
        row.completedAt !== undefined &&
        row.completedAt < args.threshold &&
        row.b2Key !== undefined &&
        row.cancelledAt === undefined &&
        row.retentionDeletedAt === undefined
    );
    return {
      rows: filtered,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Returns the IDs of any rows that still reference this
 * `b2Key`. Mirrors `postMigrationStorageCleanup.findLiveStorageReferencesForCleanup`
 * but uses the B2 ledger columns (`b2Key`) instead of `storageId`.
 *
 * If any of the four slots is non-null, the blob must stay
 * alive — even past retention. (A chat admin-restored row can
 * reference the same b2Key up to 30 days after the chat row
 * was soft-deleted; the chat retention cron hard-deletes the
 * row after that window. We do NOT enforce the chat retention
 * window here because if the chat row still exists, the blob
 * MUST stay alive even past the 18-month B2 retention deadline;
 * an admin-restored row depends on it.)
 *
 * Soft-deleted rows count as LIVE — same reasoning as
 * `postMigrationStorageCleanup` (an admin-restored chat message
 * depends on the blob being there).
 */
export const findLiveB2ReferencesForRetention = internalQuery({
  args: { b2Key: v.string() },
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
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    const resource = await ctx.db
      .query("instructorResources")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    const chatMessage = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    const noteComment = await ctx.db
      .query("workspaceNoteComments")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
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
 * Atomically marks a row as cleaned-up. Idempotent: a second
 * call returns `{ marked: false }` so the orchestrator does not
 * double-count. The CAS predicate
 * (`retentionDeletedAt === undefined`) catches a concurrent
 * tick that already stamped the row.
 */
export const markRetentionDeleted = internalMutation({
  args: {
    fileUploadId: v.id("fileUploads"),
    deletedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fileUploadId);
    if (!row) {
      return { marked: false };
    }
    if (row.retentionDeletedAt !== undefined) {
      return { marked: false };
    }
    await ctx.db.patch(args.fileUploadId, {
      retentionDeletedAt: args.deletedAt,
    });
    return { marked: true };
  },
});

/**
 * PR workspace-storage-3c cron entry point. Scans `fileUploads`
 * for completed rows older than `WORKSPACE_RETENTION_MS` whose
 * B2 copy has no live references and deletes the B2 object +
 * stamps the ledger.
 */
export const cleanupExpiredWorkspaceB2Uploads = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    scanned: number;
    deletedObjects: number;
    skippedLiveRefs: number;
    skippedAlreadyDeleted: number;
    errors: string[];
  }> => {
    const threshold = Date.now() - WORKSPACE_RETENTION_MS;

    let totalScanned = 0;
    let totalDeletedObjects = 0;
    let totalSkippedLiveRefs = 0;
    let totalSkippedAlreadyDeleted = 0;
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
        internal.cleanup.workspaceB2Retention.listRetentionCandidates,
        { threshold, limit: BATCH_SIZE, cursor }
      );
      batchesProcessed++;
      totalScanned += page.rows.length;

      for (const row of page.rows) {
        if (!row.b2Key) {
          continue;
        }
        const liveRefs = await ctx.runQuery(
          internal.cleanup.workspaceB2Retention.findLiveB2ReferencesForRetention,
          { b2Key: row.b2Key }
        );
        const anyLive =
          liveRefs.imageId ||
          liveRefs.resourceId ||
          liveRefs.chatMessageId ||
          liveRefs.noteCommentId;
        if (anyLive) {
          totalSkippedLiveRefs++;
          continue;
        }

        try {
          await ctx.runAction(
            internal.workspaceStorage.deleteFromB2WorkspaceAction,
            {
              b2Key: row.b2Key,
            }
          );
          const stamped = await ctx.runMutation(
            internal.cleanup.workspaceB2Retention.markRetentionDeleted,
            { fileUploadId: row._id, deletedAt: Date.now() }
          );
          if (stamped.marked) {
            totalDeletedObjects++;
          } else {
            totalSkippedAlreadyDeleted++;
          }
        } catch (err) {
          errors.push(
            `cleanup row ${row._id} b2Key ${row.b2Key}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      if (cursor === page.cursor) {
        // Defensive: paginate() should advance, but if a stale
        // snapshot returns the same cursor twice we break the
        // loop instead of spinning.
        break;
      }
      cursor = page.cursor;
    }

    return {
      scanned: totalScanned,
      deletedObjects: totalDeletedObjects,
      skippedLiveRefs: totalSkippedLiveRefs,
      skippedAlreadyDeleted: totalSkippedAlreadyDeleted,
      errors,
    };
  },
});

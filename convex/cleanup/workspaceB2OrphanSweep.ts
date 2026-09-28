import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * PR workspace-storage-3c: weekly safety-net sweep that deletes
 * B2 objects whose Convex-side ledger is either cancelled and
 * never cleaned up, or stamped as cleaned-up-but-orphaned.
 *
 * Why a SECOND cron alongside `cleanupRejectedB2Upload`:
 *   - `cleanupRejectedB2Upload` runs once when a binding is
 *     rejected (immediate, transactional). It retries 3 times
 *     with backoff and reschedules on transient failures. On
 *     permanent failures it stops trying — to avoid burning
 *     compute against a key the bucket refuses to recognise.
 *   - This sweep runs weekly and re-attempts the DELETE for
 *     any `fileUploads` row whose B2 binding is cancelled but
 *     whose `trashedAt` is still unset. A 403 from the bucket
 *     might have been a transient configuration glitch that
 *     cleared in the last 7 days; a 404 was already treated as
 *     success by the immediate cleanup, so it won't show up
 *     here.
 *
 * Safety:
 *   - Soft-deleted referencing rows count as LIVE (mirrors
 *     `postMigrationStorageCleanup.findLiveStorageReferencesForCleanup`).
 *     A chat message restored 5 days after soft-delete must
 *     still be able to reach its blob.
 *   - The `trashedAt` field is stamped AFTER a successful
 *     delete; a failed delete leaves it unset so the next
 *     weekly tick retries.
 *   - Pagination terminates on `page.cursor === null` (end of
 *     index), NOT on `page.rows.length === 0` (filtered-empty
 *     page). Stamped rows remain at the front of the index.
 *
 * Cron runs weekly (`convex/crons.ts`).
 */

const BATCH_SIZE = 50;
/** Soft upper bound on candidates processed in a single cron tick. */
const MAX_CANDIDATES_PER_TICK = 12_000;
/** Hard upper bound on index pages read in a single cron tick. */
const MAX_BATCHES_PER_TICK = 250;

/**
 * Returns up to `limit` `fileUploads` rows whose B2 binding was
 * cancelled (`cancelledAt !== undefined`) but whose `trashedAt`
 * is still unset, meaning the immediate cleanup action either
 * never ran (scheduled-job failure, paused crons) or hit a
 * permanent failure it gave up on. Non-cancelled rows are
 * excluded — they belong to the retention cron, not here.
 */
export const listOrphanCandidates = internalQuery({
  args: {
    limit: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("fileUploads")
      .withIndex(
        "by_trashedAt_cancelledAt_uploadedAt",
        (q) =>
          q
            .eq("trashedAt", undefined)
            .gt("cancelledAt", 0)
      )
      .paginate({ numItems: args.limit, cursor: args.cursor ?? "" });
    const filtered = page.page.filter(
      (row) =>
        row.cancelledAt !== undefined &&
        row.trashedAt === undefined &&
        row.b2Key !== undefined
    );
    return {
      rows: filtered,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Returns the IDs of any rows that still reference this
 * `b2Key`. Mirrors the retention cron's `findLiveB2ReferencesForRetention`
 * — the same four-table scan.
 */
export const findLiveB2ReferencesForOrphan = internalQuery({
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
 * Atomically stamps `trashedAt`. Idempotent via CAS.
 */
export const markB2OrphanTrashed = internalMutation({
  args: {
    fileUploadId: v.id("fileUploads"),
    deletedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fileUploadId);
    if (!row) {
      return { marked: false };
    }
    if (row.trashedAt !== undefined) {
      return { marked: false };
    }
    await ctx.db.patch(args.fileUploadId, {
      trashedAt: args.deletedAt,
    });
    return { marked: true };
  },
});

/**
 * PR workspace-storage-3c cron entry point. Weekly retry of
 * B2 DELETE for cancelled-but-not-cleaned `fileUploads` rows.
 */
export const cleanupOrphanB2Objects = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    scanned: number;
    deletedObjects: number;
    skippedLiveRefs: number;
    skippedAlreadyDeleted: number;
    errors: string[];
  }> => {
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
        internal.cleanup.workspaceB2OrphanSweep.listOrphanCandidates,
        { limit: BATCH_SIZE, cursor }
      );
      batchesProcessed++;
      totalScanned += page.rows.length;

      for (const row of page.rows) {
        if (!row.b2Key) {
          continue;
        }
        const liveRefs = await ctx.runQuery(
          internal.cleanup.workspaceB2OrphanSweep.findLiveB2ReferencesForOrphan,
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
            internal.cleanup.workspaceB2OrphanSweep.markB2OrphanTrashed,
            { fileUploadId: row._id, deletedAt: Date.now() }
          );
          if (stamped.marked) {
            totalDeletedObjects++;
          } else {
            totalSkippedAlreadyDeleted++;
          }
        } catch (err) {
          errors.push(
            `orphan-sweep row ${row._id} b2Key ${row.b2Key}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      if (cursor === page.cursor) {
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

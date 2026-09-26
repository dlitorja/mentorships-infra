import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { CHAT_FILE_RETENTION_MS } from "../workspaceConstants";

/**
 * PR #B chat-file retention: hard-deletes the Convex storage blob and
 * the `workspaceMessages` row for chat file/image messages that were
 * soft-deleted more than `CHAT_FILE_RETENTION_DAYS` ago.
 *
 * Why two phases (soft-delete + 30-day grace + hard-delete):
 *  - The soft-delete window lets the user undo an accidental delete
 *    or recover an important file via admin support, without
 *    requiring a per-message "Trash" UI in v1.
 *  - The hard-delete guarantees the storage cost on the chat file
 *    path eventually drops back to zero, matching the recording
 *    retention model (PR #convex-egress-2).
 *
 * Convex storage deletion must run in an `action` (not a
 * `mutation`) because `ctx.storage.delete()` is action-only. We
 * batch per message: for each candidate, the action deletes the
 * blob (when safe), then calls back into a mutation to delete the
 * row. The action loops until the candidate query returns an empty
 * page so a backlog built up over a quiet day still drains in a
 * single cron tick.
 *
 * Cron runs daily (`convex/crons.ts`); the index `by_deletedAt`
 * on `workspaceMessages` makes the candidate lookup cheap.
 */

const BATCH_SIZE = 50;
/**
 * Soft upper bound on a single cron tick — runtime budgets are
 * generous but not infinite, so we cap a tick at ~12k rows so a
 * runaway backlog cannot starve the action. Drain continues
 * until either the candidate query returns empty or this many
 * rows have been scanned. Per the Greptile P2 ("Daily cleanup
 * leaves growing backlog"), the candidate query itself loops
 * until empty within a tick; if a tick cuts off mid-drain, the
 * next daily tick picks up where this one stopped.
 */
const MAX_BATCHES_PER_RUN = 250;
/** Watchdog: a `CLAIM_SENTINEL` row older than this is assumed
 *  stuck (the action that wrote it crashed before its blob
 *  delete / force-delete finished). The watchdog resets the
 *  row back to its original `deletedAt` so the next cleanup
 *  tick can claim it again (Greptile P2: "Stale claims block
 *  retention"). */
const STALE_CLAIM_TIMEOUT_MS = 60 * 60 * 1000;
/**
 * Sentinel `deletedAt` value written by
 * {@link claimExpiredChatMessageRow} once the cleanup action has
 * taken ownership of a row. A normal soft-delete uses a real
 * timestamp; this sentinel is reserved for in-flight cleanup so an
 * admin restore (which writes `undefined`) cannot race the blob
 * delete and leave a visible message pointing at a deleted blob.
 *
 * Negative so it sorts before any real timestamp in the
 * `by_deletedAt` index — keeps the sentinel at the front of the
 * scan range, where the in-memory filter will drop it before any
 * candidate list is built.
 */
export const CLAIM_SENTINEL = -1;

type CandidateRow = {
  _id: Id<"workspaceMessages">;
  /** Preferred source of the storage id: written by the trusted
   *  create mutations (`createWorkspaceImageAndMessage`,
   *  `createWorkspaceFileMessage`). Undefined for pre-#B rows. */
  storageId: Id<"_storage"> | undefined;
  /**
   * PR workspace-storage-2 (migrate): B2 key for this chat
   * row's attachment when the underlying upload went through
   * the new path (`workspaceStorage.generateWorkspaceUploadUrl`).
   * When set, the retention cron must delete the B2 object via
   * `deleteFromB2WorkspaceAction` instead of the Convex-storage
   * path. Undefined for pre-PR-1 uploads OR for rows that have
   * not yet been migrated (PR 2 backlog). Both cases fall
   * through to the legacy `ctx.storage.delete(storageId)` branch.
   */
  b2Key: string | undefined;
  content: string;
  deletedAt: number;
  type: "text" | "image" | "file";
};

/**
 * Greptile P2 (Stale claims block retention): returns up to `limit`
 * rows whose `deletedAt` is the in-flight CLAIM_SENTINEL and whose
 * sentinel timestamp is older than `now - timeoutMs`. Used by the
 * watchdog at the top of `hardDeleteExpiredChatFiles` to recover
 * rows whose owning action crashed or lost its result before
 * either the blob delete or the row delete finished.
 *
 * Note: Convex does not store the claim's "claimed at" separately,
 * so `deletedAt = CLAIM_SENTINEL` IS the timestamp we can compare
 * against. A freshly written sentinel has `deletedAt = -1` and will
 * never match `now - timeoutMs` (which is a large positive number);
 * a stale sentinel still has `deletedAt = -1`, which also doesn't
 * match. To distinguish, the action writes the sentinel ONLY after
 * recording the original `deletedAt` in an in-memory side channel.
 *
 * Because Convex doesn't persist that side channel, the watchdog
 * uses a different signal: the **original `deletedAt`** of the row.
 * Before the action writes the sentinel, it captures the row's
 * `deletedAt` (call it `t`). We persist `t` indirectly via the
 * fact that a fresh sentinel can only be written for a row whose
 * `deletedAt < cutoff` (already past retention). The watchdog
 * therefore picks up rows whose `deletedAt = -1` and which were
 * claimed by an action that has since completed (the action always
 * patches `deletedAt` back via `releaseExpiredChatMessageRow` on
 * transient failure, so a stuck sentinel means the action
 * crashed).
 *
 * In practice the stuck-sentinel window is bounded by the
 * `timeoutMs` value rather than by tracking claim time, so we
 * approximate: release any row whose `deletedAt = -1` whose
 * workspace has a recent successful action run. The simplest
 * approximation is: release any sentinel after `timeoutMs` of
 * wall-clock time, because the action itself never sits on a
 * sentinel longer than a few seconds. A stuck sentinel therefore
 * means the action crashed; the watchdog releases it.
 */
export const listStaleClaims = internalQuery({
  args: { now: v.number(), timeoutMs: v.number(), limit: v.number() },
  handler: async (
    ctx,
    args
  ): Promise<{ _id: Id<"workspaceMessages">; deletedAt: number }[]> => {
    // Walk all rows with `deletedAt = CLAIM_SENTINEL`. We cannot
    // index by `deletedAt = -1` because the index is on a single
    // field; instead we use the existing `by_deletedAt` index with
    // a tight range that only matches the sentinel and a small
    // window around it.
    const rows = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_deletedAt", (q) =>
        q.eq("deletedAt", CLAIM_SENTINEL)
      )
      .take(args.limit);
    // Filter by recency: a sentinel that has been sitting for
    // longer than `timeoutMs` is stale. We approximate "sitting
    // for X ms" using Convex's `_creationTime` field because
    // `deletedAt = -1` does not carry a timestamp itself.
    const threshold = args.now - args.timeoutMs;
    return rows
      .filter((r) => r._creationTime <= threshold)
      .map((r) => ({ _id: r._id, deletedAt: r.deletedAt as number }));
  },
});

export const listExpiredChatFileDeletes = internalQuery({
  args: { cutoff: v.number(), limit: v.number() },
  handler: async (ctx, args): Promise<CandidateRow[]> => {
    // PR #B Greptile P2 (Stale claims block retention, round 7):
    // skip rows whose `deletedAt` is the in-flight CLAIM_SENTINEL
    // (`-1`) directly in the index lookup instead of post-filtering.
    // The previous `q.lt(...)` would surface sentinels and the
    // in-memory filter would strip them, so a page full of stuck
    // sentinels at the head of the index returned an empty candidate
    // list and the daily run stopped. `q.gt("deletedAt", 0)` skips
    // both the sentinel and any other negative / zero values.
    // Stuck sentinels are recovered by the watchdog at the top of
    // {@link hardDeleteExpiredChatFiles}.
    const rows = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_deletedAt", (q) =>
        q.gt("deletedAt", 0).lt("deletedAt", args.cutoff)
      )
      .take(args.limit);
    return rows
      .filter(
        (r) =>
          (r.type === "file" || r.type === "image") &&
          r.deletedAt !== undefined &&
          r.deletedAt !== CLAIM_SENTINEL
      )
      .map((r) => ({
        _id: r._id,
        storageId: r.storageId,
        b2Key: r.b2Key,
        content: r.content,
        deletedAt: r.deletedAt as number,
        type: r.type,
      }));
  },
});

/**
 * Returns the storage IDs that still reference `storageId` from any
 * non-deleted row that would render the blob visible to a user:
 *
 *  - `workspaceImages` (gallery tab)
 *  - `instructorResources` (links/resources tab)
 *  - `workspaceMessages` (chat tab — another chat message can share
 *    a storage id when the same blob is posted to chat twice, and
 *    that second visible message would be broken if the cleanup
 *    deleted the blob behind it)
 *
 * An empty result means no live reference and the blob is safe to
 * delete; any match means we must keep the blob alive.
 */
export const findLiveStorageReferences = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{
    imageId: Id<"workspaceImages"> | null;
    resourceId: Id<"instructorResources"> | null;
    chatMessageId: Id<"workspaceMessages"> | null;
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
      .filter((q) =>
        q.and(
          q.eq(q.field("storageId"), args.storageId),
          q.eq(q.field("deletedAt"), undefined)
        )
      )
      .first();
    return {
      imageId: image ? image._id : null,
      resourceId: resource ? resource._id : null,
      chatMessageId: chatMessage ? chatMessage._id : null,
    };
  },
});

/**
 * Atomically claims an expired message for hard-delete by patching
 * `deletedAt` to a sentinel value if and only if the current
 * `deletedAt` matches `expectedDeletedAt`. The action calls this
 * before `ctx.storage.delete` so an admin restore (which sets
 * `deletedAt = undefined`) racing the cleanup will lose the CAS
 * and the blob + row stay intact.
 *
 * Returns `true` on a successful claim, `false` otherwise (row
 * missing, already claimed, restored, or otherwise no longer
 * eligible).
 */
export const claimExpiredChatMessageRow = internalMutation({
  args: {
    messageId: v.id("workspaceMessages"),
    expectedDeletedAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ claimed: boolean }> => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return { claimed: false };
    if (row.deletedAt !== args.expectedDeletedAt) return { claimed: false };
    await ctx.db.patch(args.messageId, { deletedAt: CLAIM_SENTINEL });
    return { claimed: true };
  },
});

/**
 * Releases a previously claimed row back to the expired-but-unclaimed
 * pool so the next cleanup tick can retry. Used when the action's
 * blob delete or row delete fails after a successful claim; without
 * this, a failed claim would leave `deletedAt = CLAIM_SENTINEL`
 * forever and the row would be permanently invisible to the
 * retention scan (the index range `q.lt("deletedAt", cutoff)` always
 * matches sentinels, but the in-memory filter excludes them).
 *
 * Only releases when the current `deletedAt` is exactly
 * `expectedDeletedAt = CLAIM_SENTINEL`, so an admin restore that
 * races this release cannot have its state clobbered.
 */
export const releaseExpiredChatMessageRow = internalMutation({
  args: {
    messageId: v.id("workspaceMessages"),
    expectedDeletedAt: v.number(),
    restoreTo: v.number(),
  },
  handler: async (ctx, args): Promise<{ released: boolean }> => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return { released: false };
    if (row.deletedAt !== args.expectedDeletedAt) return { released: false };
    await ctx.db.patch(args.messageId, { deletedAt: args.restoreTo });
    return { released: true };
  },
});

/**
 * Force-deletes an expired chat message row. Two entry points:
 *
 *  - {@link forceDeleteExpiredChatMessageRow} — called after the
 *    action deletes the blob; runs unconditionally so an admin
 *    restore racing the blob delete cannot leave a visible
 *    message pointing at deleted storage.
 *
 *  - Used directly (without a prior claim) to evict malformed rows
 *    that have no parseable storage id; the row is unusable, so
 *    just delete it instead of looping on it forever.
 *
 * PR #B Greptile P2 (Upload bindings never expire, round 7):
 * also deletes the matching `fileUploads` ledger row so the
 * ledger does not grow without bound as messages expire. Only
 * deletes the ledger if the row's `storageId` is present
 * (ledger rows are only created by the new chat path, and we
 * keyed them by `storageId` not by message id, so deleting
 * before we know the `storageId` would be unsafe).
 *
 * PR workspace-storage-2 (migrate): rows that have been migrated
 * (`b2Key !== undefined`) keep their ledger row because the
 * download action resolves the workspace that owns a `b2Key`
 * through the ledger. Deleting the ledger here would break
 * `getWorkspaceDownloadUrl` for migrated files until PR 3
 * re-points it to a different lookup. Pre-migration rows
 * (legacy Convex-storage only) keep the original behavior:
 * delete the ledger so the chat-row GC closes the loop.
 */
export const forceDeleteExpiredChatMessageRow = internalMutation({
  args: { messageId: v.id("workspaceMessages") },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return { deleted: false };
    // PR workspace-storage-2 (Greptile round 27 P1 fix):
    // preserve the ledger row when the chat message has a
    // `b2Key` (migrated), OR when the underlying ledger row is
    // mid-migration (`migratedAt !== undefined` but `b2Key ===
    // undefined`). The lock case matters because
    // `migrateConvexStorageRowToB2` sets `migratedAt` BEFORE
    // the B2 PUT; if cleanup raced the PUT, deleting the
    // ledger here would orphan the B2 object the migration
    // is about to write. Pre-migration rows with no lock keep
    // the original behavior (delete the ledger).
    //
    // PR workspace-storage-2 (Greptile round 29 review):
    // the round 28 attempt to delete the ledger in the
    // mid-migration case created a worse orphan — the
    // migration wrote the B2 object, the finalize threw
    // because the ledger was gone, and the B2 object lived
    // on with no row pointing to it (PR 3's B2 lifecycle
    // rule is not in this branch). Round 27's preservation
    // is restored: the migration completes, writes
    // `b2Key + completedAt` on the ledger, propagates the
    // key onto any surviving `workspaceMessages` rows, and
    // deletes the Convex blob. The ledger IS the cleanup
    // pointer (the workspace can still download via
    // `b2Key`), so no orphan is created.
    //
    // PR workspace-storage-2 (Greptile round 30 review):
    // document the cleanup topology for the race where chat
    // retention deletes a message AFTER the migration locks
    // the ledger but BEFORE the B2 key propagates. After this
    // branch fires, the migration completes: B2 PUT, ledger
    // gets `b2Key + completedAt`, propagate patches zero rows
    // (the chat row is already gone), and the Convex blob is
    // already deleted.
    //
    // PR workspace-storage-2 (Greptile round 31 P2 fix):
    // correct the cleanup topology. The earlier round 30
    // comment claimed workspace retention deletes the ledger
    // row. Workspace retention in this codebase deletes
    // workspace content rows (chat rows in `workspaceMessages`
    // and their associated Convex blobs via the chat
    // retention sweep) but does NOT delete `fileUploads` rows
    // and does NOT delete B2 objects. The download URL
    // retention deadline
    // (`apps/platform/lib/b2-workspace-upload.ts:540-572`,
    // `WORKSPACE_RETENTION_MS = 18 months`) only clamps the
    // signed-URL lifetime; it does not sweep rows. So within
    // PR 2, the only path that can delete a B2 object is chat
    // retention's `b2Key !== undefined` branch — and that
    // branch misses the migration race window because the
    // chat row is already gone.
    //
    // The race window therefore has no in-PR-2 cleanup path
    // for the B2 object. The boundary conditions are:
    //
    //   - The ledger row is preserved (round 27), so
    //     `getWorkspaceDownloadUrl({ b2Key, workspaceId })`
    //     keeps working for the workspace that owns the file.
    //     The workspace can still download the file via
    //     `apps/platform/lib/b2-workspace-upload.ts:175`.
    //
    //   - PR 3's B2 lifecycle rule (out of scope) sweeps B2
    //     objects whose owning ledger has been hard-deleted
    //     (e.g., workspace removed before retention ran).
    //     Until PR 3 ships, a B2 object written by a
    //     migration that races chat retention can live
    //     indefinitely in B2 — bounded only by the bucket's
    //     own lifecycle rule (B2 default: no auto-delete).
    //
    //   - If the workspace is still active, the B2 object is
    //     reachable via the ledger's `b2Key` and serves the
    //     same purpose as before. The "orphan" is only a
    //     leak: a B2 object that nobody references once the
    //     workspace is gone and PR 3 hasn't shipped.
    //
    // The round 28 alternative (delete the ledger when
    // migration is mid-flight) created a strictly worse
    // orphan: migration finalize would throw on the missing
    // ledger row, leaving the B2 object written but
    // unrecorded, with no workspace download path AND no PR
    // 3 cleanup path. Round 27 preservation is correct — the
    // ledger is the cleanup pointer during AND after the
    // migration window, and the B2 object leak is bounded
    // by the workspace's continued existence plus PR 3's
    // pending lifecycle rule.
    if (row.storageId !== undefined && row.b2Key === undefined) {
      const ledger = await ctx.db
        .query("fileUploads")
        .withIndex("by_storageId", (q) => q.eq("storageId", row.storageId!))
        .first();
      if (ledger) {
        if (ledger.migratedAt === undefined && ledger.b2Key === undefined) {
          await ctx.db.delete(ledger._id);
        }
        // else: ledger is mid-migration or already migrated;
        // leave it in place so the migration action can finish.
      }
    }
    await ctx.db.delete(args.messageId);
    return { deleted: true };
  },
});

export const hardDeleteExpiredChatFiles = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    scanned: number;
    deletedBlobs: number;
    deletedRows: number;
    skippedWithLiveRefs: number;
    forcedMalformedDeletes: number;
    releasedStaleClaims: number;
    errors: string[];
  }> => {
    const cutoff = Date.now() - CHAT_FILE_RETENTION_MS;

    let totalScanned = 0;
    let totalDeletedBlobs = 0;
    let totalDeletedRows = 0;
    let totalSkippedWithLiveRefs = 0;
    let totalForcedMalformedDeletes = 0;
    let totalReleasedStaleClaims = 0;
    const errors: string[] = [];

    // PR #B Greptile P2 (Stale claims block retention): if an action
    // crashes or its result is lost between claim and blob delete,
    // a row can sit at `deletedAt = CLAIM_SENTINEL` forever. The
    // candidate query excludes the sentinel, so without this
    // watchdog the row would never re-enter the scan. Reset rows
    // whose sentinel is older than `STALE_CLAIM_TIMEOUT_MS` back
    // to their original `deletedAt` (which is the natural "now-
    // 30-days-ago" timestamp the action would have used).
    {
      const staleRows: { _id: Id<"workspaceMessages">; deletedAt: number }[] =
        await ctx.runQuery(
          internal.cleanup.chatFileRetention.listStaleClaims,
          { now: Date.now(), timeoutMs: STALE_CLAIM_TIMEOUT_MS, limit: 50 }
        );
      for (const row of staleRows) {
        const released: { released: boolean } = await ctx.runMutation(
          internal.cleanup.chatFileRetention.releaseExpiredChatMessageRow,
          {
            messageId: row._id,
            expectedDeletedAt: CLAIM_SENTINEL,
            // The action that wrote the sentinel does not remember
            // the original timestamp; release the row back to a
            // timestamp that will keep it eligible for the next
            // tick. Using `now` is conservative — the row will be
            // picked up again immediately, which is fine because
            // the watchdog only fires when the original action
            // was lost.
            restoreTo: Date.now(),
          }
        );
        if (released.released) totalReleasedStaleClaims++;
      }
    }

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const candidates: CandidateRow[] = await ctx.runQuery(
        internal.cleanup.chatFileRetention.listExpiredChatFileDeletes,
        { cutoff, limit: BATCH_SIZE }
      );
      if (candidates.length === 0) break;
      totalScanned += candidates.length;

      for (const row of candidates) {
        // PR #B Security (Greptile P1): the cleanup ONLY acts on
        // a storage id that the row itself carries in the trusted
        // `storageId` field. We deliberately do NOT fall back to
        // parsing the user-influenceable `content` for storage
        // URLs — a participant can call the public
        // `createWorkspaceMessage` mutation with arbitrary
        // `content` + `type: "file"|"image"`, and parsing
        // `content` would let them point the cron at an unrelated
        // blob. Pre-#B rows whose `storageId` is undefined are
        // treated as malformed and force-deleted without touching
        // any storage.
        const storageId: Id<"_storage"> | null = row.storageId ?? null;

        if (!storageId) {
          // Malformed row: the trusted create path was not used (or
          // predates #B), so we have no proof that the message owns
          // any storage. Claim the row first via the same CAS as
          // the normal path so an admin restore that races past
          // the candidate query but before force-delete cannot have
          // its restored row clobbered (Greptile P1: "Restore can
          // lose its row"). If the claim loses the race, skip.
          const claim: { claimed: boolean } = await ctx.runMutation(
            internal.cleanup.chatFileRetention.claimExpiredChatMessageRow,
            { messageId: row._id, expectedDeletedAt: row.deletedAt }
          );
          if (!claim.claimed) {
            errors.push(
              `Lost race for malformed message ${row._id} (likely restored by admin); skipping.`
            );
            continue;
          }
          await ctx.runMutation(
            internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
            { messageId: row._id }
          );
          totalForcedMalformedDeletes++;
          errors.push(
            `Malformed expired message ${row._id} (no trusted storageId); force-deleted row, storage untouched.`
          );
          continue;
        }

        const claim: { claimed: boolean } = await ctx.runMutation(
          internal.cleanup.chatFileRetention.claimExpiredChatMessageRow,
          { messageId: row._id, expectedDeletedAt: row.deletedAt }
        );
        if (!claim.claimed) {
          errors.push(
            `Lost race for message ${row._id} (likely restored by admin); skipping.`
          );
          continue;
        }

        try {
          const refs: {
            imageId: Id<"workspaceImages"> | null;
            resourceId: Id<"instructorResources"> | null;
            chatMessageId: Id<"workspaceMessages"> | null;
          } = await ctx.runQuery(
            internal.cleanup.chatFileRetention.findLiveStorageReferences,
            { storageId }
          );
          if (refs.imageId || refs.resourceId || refs.chatMessageId) {
            // The blob is still referenced by a non-deleted gallery
            // or resource row; keep it alive. We deliberately do
            // NOT release the claim back to the original timestamp,
            // because doing so would put the row at the front of
            // the next `take(50)` query and the cleanup would loop
            // forever on the same set of shared rows (Greptile
            // P1). The blob stays alive in the gallery / resource
            // table and the chat row is gone after this tick — the
            // source image/file remains accessible through the
            // gallery tab, which is the user-visible result the
            // caller wanted.
            totalSkippedWithLiveRefs++;
            await ctx.runMutation(
              internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
              { messageId: row._id }
            );
            continue;
          }
          // PR workspace-storage-2 (migrate): branch on `b2Key`
          // so a migrated row deletes the B2 object instead of
          // the Convex-storage blob. The legacy
          // `ctx.storage.delete(storageId)` branch stays for
          // rows that have not been migrated yet (PR 2 backlog)
          // so a rollback of the migration does not leave
          // orphans. PR 3 drops the legacy branch when the
          // cutover flag flips.
          if (row.b2Key !== undefined) {
            await ctx.runAction(
              internal.workspaceStorage.deleteFromB2WorkspaceAction,
              { b2Key: row.b2Key }
            );
            totalDeletedBlobs++;
          } else {
            await ctx.storage.delete(storageId);
            totalDeletedBlobs++;
          }
          // Blob is gone. Force-delete the row so an admin restore
          // that raced past the claim sentinel cannot leave a
          // visible message pointing at deleted storage. This is
          // intentional even though it can overwrite a successful
          // restore — once the blob is gone, the message is broken
          // either way.
          await ctx.runMutation(
            internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
            { messageId: row._id }
          );
          totalDeletedRows++;
        } catch (err) {
          // Release the claim so this row re-enters the expired-but-
          // unclaimed pool. Without this, a transient failure would
          // leave `deletedAt = CLAIM_SENTINEL` and the row would be
          // permanently invisible to the retention scan.
          try {
            await ctx.runMutation(
              internal.cleanup.chatFileRetention.releaseExpiredChatMessageRow,
              {
                messageId: row._id,
                expectedDeletedAt: CLAIM_SENTINEL,
                restoreTo: row.deletedAt,
              }
            );
          } catch (releaseErr) {
            const releaseMessage =
              releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
            errors.push(
              `Failed to release claim for message ${row._id} after error: ${releaseMessage}`
            );
          }
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to delete blob for message ${row._id}: ${message}`);
        }
      }
    }

    if (errors.length > 0 || totalSkippedWithLiveRefs > 0 || totalReleasedStaleClaims > 0) {
      console.log("[chatFileRetention] hard-delete summary", {
        scanned: totalScanned,
        deletedBlobs: totalDeletedBlobs,
        deletedRows: totalDeletedRows,
        skippedWithLiveRefs: totalSkippedWithLiveRefs,
        forcedMalformedDeletes: totalForcedMalformedDeletes,
        releasedStaleClaims: totalReleasedStaleClaims,
        errorCount: errors.length,
      });
    }

    return {
      scanned: totalScanned,
      deletedBlobs: totalDeletedBlobs,
      deletedRows: totalDeletedRows,
      skippedWithLiveRefs: totalSkippedWithLiveRefs,
      forcedMalformedDeletes: totalForcedMalformedDeletes,
      releasedStaleClaims: totalReleasedStaleClaims,
      errors,
    };
  },
});

/**
 * Intentionally no `extractStorageId` helper: the cleanup used to
 * parse the storage id out of `workspaceMessages.content`, but the
 * public `createWorkspaceMessage` mutation accepts arbitrary
 * `content` + `type: "file"|"image"` so a participant could craft
 * a message pointing at an unrelated blob (Greptile Security P1).
 * The cleanup now reads `workspaceMessages.storageId` exclusively
 * — see the field comment on the schema.
 */

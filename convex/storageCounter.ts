/**
 * Denormalized storage counter for video editors.
 *
 * Replaces the bounded paginated scan in
 * `convex/instructorUploads.getVideoEditorTotalStorageStats` with a
 * constant-time aggregate read. HUC-58 follow-up to PR #887.
 *
 * Source of truth: every `instructorUploads` row with `uploadedById`
 * set AND `status` not in {`deleted`, `deleting`} contributes
 * `row.size` to `usedBytes` and 1 to `fileCount` for the row's
 * `uploadedById`.
 *
 * Atomicity: counter mutations and the row write that triggers them
 * run inside the same Convex transaction when called from a public
 * mutation (e.g. `createUpload`). When called from a cron-driven
 * backfill batch, each batch is its own transaction; partial batches
 * are safe to re-run because the delta is computed per row.
 *
 * Idempotency: `applyCounterDelta` reads the previous status before
 * patching and computes the counter delta from the transition, so
 * re-running a transition (e.g. retry of a `db.patch`) does not
 * double-count. The cron backfill is also idempotent because it
 * computes from a fresh scan on every iteration.
 */
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";

/**
 * Apply a counter delta for a status transition. Reads the previous
 * status (caller-provided for in-mutation paths), computes whether
 * the row crossed the active/deletion boundary, and patches the
 * counter row accordingly. Creates the row if absent.
 *
 * First-creation behavior: when the counter row does not exist AND
 * the editor has historical uploads, this function performs a
 * full-aggregate scan and seeds the counter with the correct total
 * rather than just the single-row delta. This prevents the
 * "first change hides historical uploads" race where a single
 * delta on a fresh counter understates usage. (Round-25 Greptile
 * P1 #4.)
 *
 * Active statuses (counted): `pending`, `uploading`, `completed`,
 * `archived`, `failed`. Inactive (not counted): `deleted`, `deleting`.
 *
 * `uploadedById` may be undefined (admin/instructor uploads) — those
 * do not contribute to any video editor counter and this function is a
 * no-op.
 */
export async function applyCounterDelta(
  ctx: MutationCtx,
  args: {
    uploadedById: string | undefined;
    size: number;
    fromStatus: string | undefined;
    toStatus: string;
  }
): Promise<void> {
  if (!args.uploadedById) return;
  const wasActive = isActiveStatus(args.fromStatus);
  const isActive = isActiveStatus(args.toStatus);

  const uploadedById = args.uploadedById;

  const existing = await ctx.db
    .query("videoEditorStorageStats")
    .withIndex("by_videoEditorId", (q) =>
      q.eq("videoEditorId", uploadedById)
    )
    .first();

  // First-creation seed: when the counter row does not exist, the
  // editor has historical rows. The row that triggered this
  // mutation has already been inserted/patched before applyCounterDelta
  // runs (see instructorUploads.createUpload/softDeleteUpload/etc.),
  // so the aggregate over all rows reflects the post-mutation state.
  // Use it directly; do NOT add the delta on top, or we would
  // double-count (round-25 Greptile P1 #4 follow-up).
  //
  // Defensive: the aggregate scan walks every `instructorUploads` row
  // for this editor and can blow past Convex's per-mutation read
  // budget for editors with many historical uploads. The resulting
  // exception would propagate to the parent mutation (e.g.
  // completeUpload) and surface as a 500 to the user, even though
  // the source-of-truth row in `instructorUploads` was already
  // written and B2 already accepted the multipart upload — i.e. the
  // editor sees a confusing 500 for an upload that actually exists.
  //
  // We must guarantee a counter row exists so the read path
  // (`getVideoEditorTotalStorageStats`) does not fall through to
  // the paginated scan — which itself can blow the read budget and
  // 500 the dashboard for the same editor.
  //
  // The hourly backfill cron (`backfillVideoEditorStorageCounter` in
  // convex/actions/backfillVideoEditorStorageCounter.ts) is the safe
  // owner of first-counter creation: it walks the same scan inside
  // an action (not a mutation) with per-batch budget tracking, and
  // is unaffected by user-facing request latency. If the inline
  // aggregate insert throws here, we fall back to a 0/0 placeholder
  // row whose `lastUpdatedAt: 0` sentinel marks it as
  // "needs reconciliation"; the next cron pass (within an hour)
  // writes the real aggregate with a real timestamp. The placeholder
  // prevents the read path from looping on the same scan-failure
  // AND signals to the UI (which checks `lastUpdatedAt`) that the
  // row is a placeholder, not authoritative zero. The parent
  // mutation must never fail for this reason.
  //
  // `lastUpdatedAt: 0` is a sentinel: real updates always use
  // `Date.now()`. Consumers (the dashboard's storage-usage UI)
  // MUST treat `lastUpdatedAt === 0` as "refreshing" / "loading"
  // rather than as "fresh data showing zero usage" — otherwise the
  // editor sees a misleading "0 bytes" right after a successful
  // upload that the inline aggregate couldn't compute.
  if (!existing) {
    let usedBytes = 0;
    let fileCount = 0;
    let lastUpdatedAt: number = Date.now();
    let aggregateSucceeded = false;
    try {
      const aggregate = await computeFullAggregate(ctx, uploadedById);
      usedBytes = aggregate.usedBytes;
      fileCount = aggregate.fileCount;
      aggregateSucceeded = true;
    } catch (error) {
      lastUpdatedAt = 0;
      console.error(
        "[storageCounter] inline aggregate scan failed; seeding 0/0 placeholder with lastUpdatedAt=0 sentinel, deferring real aggregate to backfill cron",
        {
          videoEditorId: uploadedById,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    try {
      await ctx.db.insert("videoEditorStorageStats", {
        videoEditorId: uploadedById,
        usedBytes,
        fileCount,
        lastUpdatedAt,
      });
    } catch (insertError) {
      // Most likely cause: another writer (the backfill cron, or a
      // concurrent request) inserted a counter row between our
      // `existing` check and our `insert`. That's fine — first
      // writer wins, the counter row exists, and the read path no
      // longer needs the paginated scan fallback.
      console.error(
        "[storageCounter] inline counter insert failed (likely duplicate)",
        {
          videoEditorId: uploadedById,
          aggregateSucceeded,
          error:
            insertError instanceof Error
              ? insertError.message
              : String(insertError),
        },
      );
    }
    return;
  }

  if (wasActive === isActive) return;

  const deltaBytes = isActive ? args.size : -args.size;
  const deltaCount = isActive ? 1 : -1;

  // Sentinel preservation: if the existing row is a placeholder
  // (lastUpdatedAt === 0, written by the first-creation seed when
  // the inline aggregate scan could not complete), DO NOT replace
  // the sentinel with Date.now() on a subsequent patch — that
  // would lose the marker that tells the UI the counter is not
  // authoritative. The delta math still applies (the placeholder
  // acts as a 0/0 baseline), and the hourly backfill cron will
  // overwrite the whole row with the real aggregate + real
  // timestamp on its next pass.
  await ctx.db.patch(existing._id, {
    usedBytes: Math.max(0, existing.usedBytes + deltaBytes),
    fileCount: Math.max(0, existing.fileCount + deltaCount),
    lastUpdatedAt: existing.lastUpdatedAt === 0 ? 0 : Date.now(),
  });
}

function isActiveStatus(status: string | undefined): boolean {
  // `undefined` means "row didn't exist before this transition" (e.g.
  // `createUpload`). Treat it as not-active so the delta math works:
  // new active row → +size/+1, new inactive row → no-op.
  if (status === undefined) return false;
  return status !== "deleted" && status !== "deleting";
}

/**
 * Compute the full aggregate over all `instructorUploads` rows for a
 * given video editor. Walks every row including deleted/deleting
 * (only counts active rows in the totals). Bounded to 1000 pages of
 * 4k rows = 4M rows max — well above the largest expected editor
 * history. Exported so test code can mock it via `vi.spyOn` to
 * simulate a Convex read-budget failure in the inline seed path.
 */
export async function computeFullAggregate(
  ctx: MutationCtx,
  videoEditorId: string
): Promise<{
  usedBytes: number;
  fileCount: number;
  totalRows: number;
}> {
  let usedBytes = 0;
  let fileCount = 0;
  let totalRows = 0;
  let cursor: string | null = null;
  let isDone = false;
  // Bound the loop so a corrupted index can't run forever.
  for (let i = 0; i < 1000 && !isDone; i += 1) {
    const page = await ctx.db
      .query("instructorUploads")
      .withIndex("by_uploadedById", (q) =>
        q.eq("uploadedById", videoEditorId)
      )
      .paginate({ cursor, numItems: 4_000 });
    for (const row of page.page) {
      totalRows += 1;
      if (row.status === "deleted" || row.status === "deleting") continue;
      usedBytes += row.size;
      fileCount += 1;
    }
    isDone = page.isDone;
    cursor = page.isDone ? null : page.continueCursor;
    if (cursor === null) break;
  }
  return { usedBytes, fileCount, totalRows };
}

/**
 * Read the counter for a video editor. Returns null if no row
 * exists (caller should fall back to the backfill scan if needed).
 * Used by `getVideoEditorTotalStorageStats` and
 * `computeVideoEditorOpenStorageStats`.
 */
export const getVideoEditorStorageStatsFromCounter = internalMutation({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId)
      )
      .first();
    if (!row) return null;
    return {
      usedBytes: row.usedBytes,
      fileCount: row.fileCount,
      lastUpdatedAt: row.lastUpdatedAt,
    };
  },
});

/**
 * Set the counter to an absolute value (used by the backfill cron
 * and admin-only repair tools). Idempotent: re-running with the same
 * value produces no change.
 */
export const setVideoEditorStorageCounter = internalMutation({
  args: {
    videoEditorId: v.string(),
    usedBytes: v.number(),
    fileCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        usedBytes: args.usedBytes,
        fileCount: args.fileCount,
        lastUpdatedAt: Date.now(),
      });
      return { action: "updated" as const, id: existing._id };
    }
    const id = await ctx.db.insert("videoEditorStorageStats", {
      videoEditorId: args.videoEditorId,
      usedBytes: args.usedBytes,
      fileCount: args.fileCount,
      lastUpdatedAt: Date.now(),
    });
    return { action: "created" as const, id };
  },
});

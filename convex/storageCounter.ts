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
  if (!existing) {
    const aggregate = await computeFullAggregate(ctx, uploadedById);
    await ctx.db.insert("videoEditorStorageStats", {
      videoEditorId: uploadedById,
      usedBytes: aggregate.usedBytes,
      fileCount: aggregate.fileCount,
      lastUpdatedAt: Date.now(),
    });
    return;
  }

  if (wasActive === isActive) return;

  const deltaBytes = isActive ? args.size : -args.size;
  const deltaCount = isActive ? 1 : -1;

  await ctx.db.patch(existing._id, {
    usedBytes: Math.max(0, existing.usedBytes + deltaBytes),
    fileCount: Math.max(0, existing.fileCount + deltaCount),
    lastUpdatedAt: Date.now(),
  });
}

/**
 * Walk all of an editor's `instructorUploads` rows and aggregate
 * active bytes per `uploadedById`. Used by `applyCounterDelta` on
 * first creation when the editor has historical rows. Loops until
 * the table is exhausted so we always produce a complete aggregate
 * even for editors with thousands of rows.
 */
async function computeFullAggregate(
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

function isActiveStatus(status: string | undefined): boolean {
  // `undefined` means "row didn't exist before this transition" (e.g.
  // `createUpload`). Treat it as not-active so the delta math works:
  // new active row → +size/+1, new inactive row → no-op.
  if (status === undefined) return false;
  return status !== "deleted" && status !== "deleting";
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

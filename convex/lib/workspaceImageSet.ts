import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * The most recent change to a workspace's visible image set, as a
 * timestamp (null when it has no images and none deleted).
 *
 * Used by two callers:
 *   - the Images tab's freshness check (`workspaces.getWorkspaceImageSetUpdatedAt`),
 *     to decide whether a saved ZIP is stale;
 *   - the export data query, which records the value the archive was
 *     built from (`workspaceExports.sourceUpdatedAt`) so an upload that
 *     lands mid-build does not make the finished archive look stale.
 *
 * Deletions count: removing an image after an archive was built makes
 * the archive out of date even though no new image exists.
 *
 * Two indexed single-row reads: newest live image by creation, newest
 * soft-deleted image by `deletedAt`.
 */
export async function getWorkspaceImageSetUpdatedAt(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<number | null> {
  const [latestActive, latestDeleted] = await Promise.all([
    ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
      )
      .order("desc")
      .first(),
    ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", workspaceId).gt("deletedAt", 0)
      )
      .order("desc")
      .first(),
  ]);

  const times = [latestActive?._creationTime, latestDeleted?.deletedAt].filter(
    (value): value is number => typeof value === "number"
  );
  return times.length > 0 ? Math.max(...times) : null;
}

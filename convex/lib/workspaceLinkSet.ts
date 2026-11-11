import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * The most recent change to a workspace's visible link set, as a
 * timestamp (null when it has no links and none deleted).
 *
 * Mirrors `workspaceImageSet.getWorkspaceImageSetUpdatedAt` for the
 * Links tab: the header's single CSV control only offers a download
 * while the archive is at least as new as every link. Deletions count,
 * because a CSV built before a link was removed still contains it.
 */
export async function getWorkspaceLinkSetUpdatedAt(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<number | null> {
  const [latestActive, latestDeleted] = await Promise.all([
    ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
      )
      .order("desc")
      .first(),
    ctx.db
      .query("workspaceLinks")
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

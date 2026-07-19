import { query } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

/** Finds workspaces past the 18-month retention window that haven't been marked as deleted. */
export const getWorkspacesNeedingDeletion = query({
  handler: async (ctx) => {
    const cutoff = Date.now() - EIGHTEEN_MONTHS_MS;
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt", (q) => q.lt("endedAt", cutoff))
      .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.gt(q.field("deletedAt"), cutoff)))
      .collect();

    return workspaces.map(w => ({ id: w._id, endedAt: w.endedAt, ownerId: w.ownerId, instructorId: w.instructorId }));
  },
});

/** Finds workspaces within 7, 30, or 90 days of deletion that require a retention notification. */
export const getWorkspacesForNotification = query({
  handler: async (ctx) => {
    const now = Date.now();
    const notifications: { workspaceId: string; userId: string; daysUntilDeletion: number }[] = [];

    const cutoff = Date.now() + EIGHTEEN_MONTHS_MS;
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt", (q) => q.gt("endedAt", 0))
      .filter((q) => q.lt(q.field("endedAt"), cutoff))
      .collect();

    // Bulk-fetch all seat reservations to avoid N+1 queries inside the loop
    const allSeats = await ctx.db
      .query("seatReservations")
      .collect();
    const seatSet = new Set(
      allSeats.map((s) => `${String(s.instructorId)}:${s.userId}`)
    );

    for (const workspace of workspaces) {
      if (!workspace.endedAt) continue;
      if (!workspace.instructorId) continue;

      const daysUntilDeletion = Math.floor(
        (workspace.endedAt! + EIGHTEEN_MONTHS_MS - now) / dayMs
      );

      const inWindow = (days: number) =>
        (days >= 89 && days <= 91) ||
        (days >= 29 && days <= 31) ||
        (days >= 6 && days <= 8);

      if (inWindow(daysUntilDeletion)) {
        const key = `${String(workspace.instructorId)}:${workspace.ownerId}`;
        if (seatSet.has(key)) {
          notifications.push({
            workspaceId: String(workspace._id),
            userId: workspace.ownerId,
            daysUntilDeletion,
          });
        }
      }
    }

    return notifications;
  },
});

/** Looks up a user's email address by their Clerk ID. */
export const getUserEmail = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const { clerkId } = args;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .first();

    return { email: user?.email ?? null };
  },
});

export const getUserIdByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    return { id: user?._id ?? null };
  },
});

/** Fetches a workspace's non-deleted notes and images for data export. */
export const getWorkspaceExportData = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const { workspaceId } = args;

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const notes = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
      )
      .collect();

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
      )
      .collect();

    const imagesWithUrls = await Promise.all(
      images.map(async (img) => {
        let imageUrl = img.imageUrl;
        let contentType: string | undefined;
        let fileName: string | undefined;
        if (img.storageId) {
          const [url, metadata] = await Promise.all([
            ctx.storage.getUrl(img.storageId as Id<"_storage">),
            ctx.db.system.get("_storage", img.storageId as Id<"_storage">),
          ]);
          if (url) imageUrl = url;
          contentType = metadata?.contentType ?? undefined;
          fileName = metadata?.name ?? undefined;
        }
        return {
          imageUrl,
          storageId: img.storageId,
          contentType,
          fileName,
          createdBy: img.createdBy,
          createdAt: img._creationTime,
        };
      })
    );

    return {
      workspaceName: workspace.name || "Workspace",
      notes: notes.map((n) => ({
        title: n.title,
        content: n.content,
        updatedAt: n.updatedAt,
      })),
      images: imagesWithUrls,
    };
  },
});

/**
 * PR #4b-fix: returns the owner + workspace of an export so the
 * trigger task can email the requesting user on completion. Gated
 * by CONVEX_HTTP_KEY at the HTTP layer; the query itself is a
 * single-row lookup with no PII filtering needed because only
 * server-side callers (the trigger task) can reach it.
 */
export const getWorkspaceExport = query({
  args: { exportId: v.id("workspaceExports") },
  handler: async (ctx, args) => {
    const exportDoc = await ctx.db.get(args.exportId);
    if (!exportDoc) {
      return null;
    }
    const workspace = await ctx.db.get(exportDoc.workspaceId);
    return {
      userId: exportDoc.userId,
      workspaceId: exportDoc.workspaceId,
      workspaceName: workspace?.name || "Workspace",
      status: exportDoc.status,
    };
  },
});

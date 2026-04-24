import { query } from "../_generated/server";
import { v } from "convex/values";

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

    return workspaces.map(w => ({ id: w._id, endedAt: w.endedAt, ownerId: w.ownerId, mentorId: w.mentorId }));
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
      allSeats.map((s) => `${String(s.mentorId)}:${s.userId}`)
    );

    for (const workspace of workspaces) {
      if (!workspace.endedAt) continue;
      if (!workspace.mentorId) continue;

      const daysUntilDeletion = Math.floor(
        (workspace.endedAt! + EIGHTEEN_MONTHS_MS - now) / dayMs
      );

      const inWindow = (days: number) =>
        (days >= 89 && days <= 91) ||
        (days >= 29 && days <= 31) ||
        (days >= 6 && days <= 8);

      if (inWindow(daysUntilDeletion)) {
        const key = `${String(workspace.mentorId)}:${workspace.ownerId}`;
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
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    return {
      workspaceName: workspace.name || "Workspace",
      notes: notes.map((n) => ({
        title: n.title,
        content: n.content,
        updatedAt: n.updatedAt,
      })),
      images: images.map((img) => ({
        imageUrl: img.imageUrl,
        createdBy: img.createdBy,
        createdAt: img._creationTime,
      })),
    };
  },
});

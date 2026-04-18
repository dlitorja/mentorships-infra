import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const deleteAllWorkspaceContent = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const { workspaceId } = args;

    const notes = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const note of notes) {
      await ctx.db.delete(note._id);
    }

    const links = await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const image of images) {
      await ctx.db.delete(image._id);
    }

    const messages = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.patch(workspaceId, {
      menteeImageCount: 0,
      mentorImageCount: 0,
    });

    return {
      deleted: {
        notes: notes.length,
        links: links.length,
        images: images.length,
        messages: messages.length,
      },
    };
  },
});

export const createRetentionNotification = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    notificationType: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspaceId, userId, notificationType } = args;

    const existing = await ctx.db
      .query("workspaceRetentionNotifications")
      .withIndex("by_workspaceId_userId", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("notificationType"), notificationType))
      .first();

    if (existing) {
      return { notificationId: String(existing._id), created: false };
    }

    const notificationId = await ctx.db.insert("workspaceRetentionNotifications", {
      workspaceId,
      userId,
      notificationType,
      sentAt: Date.now(),
    });

    return { notificationId: String(notificationId), created: true };
  },
});

export const updateWorkspaceExportStatus = mutation({
  args: {
    exportId: v.id("workspaceExports"),
    status: v.string(),
    downloadUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { exportId, status, downloadUrl, expiresAt } = args;

    const exportRecord = await ctx.db.get(exportId);
    if (!exportRecord) {
      throw new Error("Export not found");
    }

    const updates: Record<string, unknown> = { status };
    if (downloadUrl) updates.downloadUrl = downloadUrl;
    if (expiresAt) updates.expiresAt = expiresAt;

    await ctx.db.patch(exportId, updates);

    return { success: true };
  },
});

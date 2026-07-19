import { mutation } from "../_generated/server";
import { v } from "convex/values";

/** Deletes all notes, links, images, and messages belonging to a workspace and resets its image counts. */
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
      studentImageCount: 0,
      instructorImageCount: 0,
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

/** Creates a retention notification for a workspace user if one of the same type doesn't already exist. */
export const createRetentionNotification = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    notificationType: v.union(v.literal("expiry_warning"), v.literal("deleted")),
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

/** Updates a workspace export record's status and optionally its download URL and expiration time. */
export const updateWorkspaceExportStatus = mutation({
  args: {
    exportId: v.id("workspaceExports"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    downloadUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { exportId, status, downloadUrl, expiresAt, errorMessage } = args;

    const exportRecord = await ctx.db.get(exportId);
    if (!exportRecord) {
      throw new Error("Export not found");
    }

    // PR #4b-fix: refuse to overwrite a "completed" row with anything
    // other than "completed" so a retried trigger task does not
    // silently undo a finished export. Also refuse to mark a row
    // "completed" if the user already cancelled it ("failed").
    if (exportRecord.status === "completed" && status !== "completed") {
      throw new Error("Export already completed");
    }
    if (exportRecord.status === "failed" && status === "completed") {
      throw new Error("Export was cancelled; refusing to mark completed");
    }

    const updates: Record<string, unknown> = { status };
    if (downloadUrl !== undefined) updates.downloadUrl = downloadUrl;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt;
    if (errorMessage !== undefined) updates.errorMessage = errorMessage;

    await ctx.db.patch(exportId, updates);

    return { success: true };
  },
});

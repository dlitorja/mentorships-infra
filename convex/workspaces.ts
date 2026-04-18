import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getWorkspaceById = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

export const getUserWorkspaces = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

export const getMentorWorkspaces = query({
  args: { mentorId: v.id("mentors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaces")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .collect();
  },
});

export const createWorkspace = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.string(),
    mentorId: v.optional(v.id("mentors")),
    imageUrl: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaces", {
      ...args,
      isPublic: args.isPublic ?? false,
    });
  },
});

export const updateWorkspace = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

export const deleteWorkspace = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const getWorkspaceNotes = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const createWorkspaceNote = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    content: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceNotes", {
      ...args,
      updatedAt: Date.now(),
    });
  },
});

export const updateWorkspaceNote = mutation({
  args: {
    id: v.id("workspaceNotes"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const deleteWorkspaceNote = mutation({
  args: { id: v.id("workspaceNotes") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const getWorkspaceLinks = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const createWorkspaceLink = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    url: v.string(),
    title: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceLinks", args);
  },
});

export const deleteWorkspaceLink = mutation({
  args: { id: v.id("workspaceLinks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const getWorkspaceImages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const createWorkspaceImage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    imageUrl: v.string(),
    storageId: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceImages", args);
  },
});

export const deleteWorkspaceImage = mutation({
  args: { id: v.id("workspaceImages") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const getWorkspaceMessages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .order("asc")
      .collect();
  },
});

export const createWorkspaceMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    content: v.string(),
    type: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("file"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceMessages", {
      ...args,
      type: args.type ?? "text",
    });
  },
});

export const createWorkspaceExport = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    format: v.union(v.literal("pdf"), v.literal("markdown"), v.literal("zip")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceExports", {
      ...args,
      status: "pending",
    });
  },
});

export const updateWorkspaceExport = mutation({
  args: {
    id: v.id("workspaceExports"),
    status: v.optional(v.union(v.literal("pending"), v.literal("processing"), v.literal("completed"), v.literal("failed"))),
    downloadUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

export const getWorkspaceRetentionNotifications = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceRetentionNotifications")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const createRetentionNotification = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    notificationType: v.union(v.literal("expiry_warning"), v.literal("deleted")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceRetentionNotifications", {
      ...args,
      sentAt: Date.now(),
    });
  },
});

export const acknowledgeNotification = mutation({
  args: { id: v.id("workspaceRetentionNotifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { acknowledgedAt: Date.now() });
    return await ctx.db.get(args.id);
  },
});

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get workspace by ID
export const getById = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get workspaces by owner (student)
export const listByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("ownerId"), args.ownerId))
      .collect();
  },
});

// Get workspaces by instructor
export const listByInstructor = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();
  },
});

// Get workspace messages
export const listMessages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceMessages")
      .filter((q) => q.eq(q.field("workspaceId"), args.workspaceId))
      .collect();
  },
});

// Send message
export const sendMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    content: v.string(),
    type: v.union(v.literal("text"), v.literal("image"), v.literal("file")),
    senderRole: v.optional(v.union(
      v.literal("instructor"),
      v.literal("mentee"),
      v.literal("admin")
    )),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("workspaceMessages", {
      workspaceId: args.workspaceId,
      userId: args.userId,
      content: args.content,
      type: args.type,
      senderRole: args.senderRole,
    });
    return messageId;
  },
});

// Get workspace notes
export const listNotes = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceNotes")
      .filter((q) => q.eq(q.field("workspaceId"), args.workspaceId))
      .collect();
  },
});

// Create note
export const createNote = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    content: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const noteId = await ctx.db.insert("workspaceNotes", {
      workspaceId: args.workspaceId,
      title: args.title,
      content: args.content,
      createdBy: args.createdBy,
      updatedAt: Date.now(),
    });
    return noteId;
  },
});

// Update note
export const updateNote = mutation({
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

// Delete note
export const deleteNote = mutation({
  args: { id: v.id("workspaceNotes") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
    return { success: true };
  },
});

// Get workspace links
export const listLinks = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceLinks")
      .filter((q) =>
        q.and(
          q.eq(q.field("workspaceId"), args.workspaceId),
          q.eq(q.field("deletedAt"), undefined)
        )
      )
      .collect();
  },
});

// Create link
export const createLink = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    url: v.string(),
    title: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const linkId = await ctx.db.insert("workspaceLinks", {
      workspaceId: args.workspaceId,
      url: args.url,
      title: args.title,
      createdBy: args.createdBy,
    });
    return linkId;
  },
});

// Delete link
export const deleteLink = mutation({
  args: { id: v.id("workspaceLinks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
    return { success: true };
  },
});

// Get workspace images
export const listImages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceImages")
      .filter((q) =>
        q.and(
          q.eq(q.field("workspaceId"), args.workspaceId),
          q.eq(q.field("deletedAt"), undefined)
        )
      )
      .collect();
  },
});

// Upload workspace image
export const uploadImage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    // Check image caps (75 for mentee, 150 for mentor)
    const isMentor = args.createdBy === workspace.instructorId.toString();
    const currentCount = isMentor ? workspace.mentorImageCount : workspace.menteeImageCount;
    const cap = isMentor ? 150 : 75;

    if (currentCount >= cap) {
      await ctx.storage.delete(args.storageId);
      throw new Error(`Image cap reached (${cap})`);
    }

    const url = await ctx.storage.getUrl(args.storageId);
    const imageId = await ctx.db.insert("workspaceImages", {
      workspaceId: args.workspaceId,
      imageUrl: url,
      storageId: args.storageId,
      createdBy: args.createdBy,
    });

    // Increment counter
    if (isMentor) {
      await ctx.db.patch(args.workspaceId, {
        mentorImageCount: workspace.mentorImageCount + 1,
      });
    } else {
      await ctx.db.patch(args.workspaceId, {
        menteeImageCount: workspace.menteeImageCount + 1,
      });
    }

    return { imageId, url };
  },
});

// Delete workspace image
export const deleteImage = mutation({
  args: { id: v.id("workspaceImages") },
  handler: async (ctx, args) => {
    const image = await ctx.db.get(args.id);
    if (!image) throw new Error("Image not found");

    const workspace = await ctx.db.get(image.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    // Decrement counter
    const isMentor = image.createdBy === workspace.instructorId.toString();
    if (isMentor) {
      await ctx.db.patch(workspace._id, {
        mentorImageCount: Math.max(0, workspace.mentorImageCount - 1),
      });
    } else {
      await ctx.db.patch(workspace._id, {
        menteeImageCount: Math.max(0, workspace.menteeImageCount - 1),
      });
    }

    // Soft delete
    await ctx.db.patch(args.id, { deletedAt: Date.now() });

    // Delete from storage
    if (image.storageId) {
      await ctx.storage.delete(image.storageId);
    }

    return { success: true };
  },
});

// Create workspace (for admin)
export const create = mutation({
  args: {
    sessionPackId: v.optional(v.id("sessionPacks")),
    instructorId: v.id("instructors"),
    ownerId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    isPublic: v.boolean(),
    type: v.optional(v.union(
      v.literal("mentorship"),
      v.literal("admin_mentee"),
      v.literal("admin_instructor")
    )),
  },
  handler: async (ctx, args) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      sessionPackId: args.sessionPackId,
      instructorId: args.instructorId,
      ownerId: args.ownerId,
      name: args.name,
      description: args.description,
      isPublic: args.isPublic,
      type: args.type,
      menteeImageCount: 0,
      mentorImageCount: 0,
    });
    return workspaceId;
  },
});

// Update workspace
export const update = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

// List all workspaces (for admin)
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("workspaces").collect();
  },
});

// Get workspaces by type
export const listByType = query({
  args: {
    type: v.union(
      v.literal("mentorship"),
      v.literal("admin_mentee"),
      v.literal("admin_instructor")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("type"), args.type))
      .collect();
  },
});
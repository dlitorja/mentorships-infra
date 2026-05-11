import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// List all active instructors
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get instructor by slug
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const instructor = await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("slug"), args.slug))
      .first();
    return instructor;
  },
});

// Get instructor by ID
export const getById = query({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get instructor by user ID (Clerk)
export const getByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();
  },
});

// Create instructor
export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    email: v.optional(v.string()),
    bio: v.optional(v.string()),
    tagline: v.optional(v.string()),
    oneOnOneInventory: v.number(),
    groupInventory: v.number(),
    maxActiveStudents: v.number(),
    profileImageUrl: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    portfolioImageStorageIds: v.optional(v.array(v.string())),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.boolean(),
    isNew: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const instructorId = await ctx.db.insert("instructors", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    return instructorId;
  },
});

// Update instructor
export const update = mutation({
  args: {
    id: v.id("instructors"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    bio: v.optional(v.string()),
    tagline: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
    maxActiveStudents: v.optional(v.number()),
    profileImageUrl: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    portfolioImageStorageIds: v.optional(v.array(v.string())),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

// Delete instructor (soft delete)
export const remove = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      deletedAt: Date.now(),
      isActive: false,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// Create testimonial for instructor
export const createTestimonial = mutation({
  args: {
    instructorId: v.id("instructors"),
    name: v.string(),
    text: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const testimonialId = await ctx.db.insert("instructorTestimonials", {
      instructorId: args.instructorId,
      name: args.name,
      text: args.text,
      role: args.role,
      createdAt: Date.now(),
    });
    return testimonialId;
  },
});

// Get testimonials for instructor
export const getTestimonials = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructorTestimonials")
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();
  },
});

// Delete testimonial
export const deleteTestimonial = mutation({
  args: { id: v.id("instructorTestimonials") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Create mentee result
export const createMenteeResult = mutation({
  args: {
    instructorId: v.id("instructors"),
    imageUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.string()),
    imageUploadPath: v.optional(v.string()),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const resultId = await ctx.db.insert("menteeResults", {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      imageStorageId: args.imageStorageId,
      imageUploadPath: args.imageUploadPath,
      studentName: args.studentName,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
    return resultId;
  },
});

// Get mentee results for instructor
export const getMenteeResults = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("menteeResults")
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();
  },
});

// Delete mentee result
export const deleteMenteeResult = mutation({
  args: { id: v.id("menteeResults") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Get all instructors (including inactive) for admin
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instructors").collect();
  },
});

// Get all instructors with stats for admin dashboard
export const getInstructorsForAdmin = query({
  args: {},
  handler: async (ctx) => {
    const instructors = await ctx.db.query("instructors").collect();
    const workspaces = await ctx.db.query("workspaces").collect();

    const activeWorkspaces = workspaces.filter(
      (w) => w.endedAt === undefined && w.deletedAt === undefined
    );

    const instructorStats = new Map<string, number>();

    for (const workspace of activeWorkspaces) {
      const current = instructorStats.get(workspace.instructorId) || 0;
      instructorStats.set(workspace.instructorId, current + 1);
    }

    return instructors.map((instructor) => ({
      ...instructor,
      activeMenteeCount: instructorStats.get(instructor._id) || 0,
    }));
  },
});

// Update inventory for instructor
export const updateInventory = mutation({
  args: {
    id: v.id("instructors"),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, oneOnOneInventory, groupInventory } = args;
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (oneOnOneInventory !== undefined) {
      updates.oneOnOneInventory = oneOnOneInventory;
    }
    if (groupInventory !== undefined) {
      updates.groupInventory = groupInventory;
    }
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

// Link user to instructor
export const linkUser = mutation({
  args: {
    id: v.id("instructors"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      userId: args.userId,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

// Upload profile image (returns storage URL)
export const uploadProfileImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    await ctx.db.patch(args.instructorId, {
      profileImageUrl: url ?? undefined,
      profileImageStorageId: args.storageId,
      updatedAt: Date.now(),
    });
    return { url };
  },
});

// Add portfolio image
export const addPortfolioImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) throw new Error("Instructor not found");

    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Failed to get URL for storage");
    const currentImages = instructor.portfolioImages || [];
    const currentStorageIds = instructor.portfolioImageStorageIds || [];

    await ctx.db.patch(args.instructorId, {
      portfolioImages: [...currentImages, url],
      portfolioImageStorageIds: [...currentStorageIds, args.storageId],
      updatedAt: Date.now(),
    });
    return { url };
  },
});
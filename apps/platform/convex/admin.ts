import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const createInstructor = mutation({
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
    profileImageUploadPath: v.optional(v.string()),
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
      name: args.name,
      slug: args.slug,
      email: args.email,
      bio: args.bio,
      tagline: args.tagline,
      oneOnOneInventory: args.oneOnOneInventory,
      groupInventory: args.groupInventory,
      maxActiveStudents: args.maxActiveStudents,
      profileImageUrl: args.profileImageUrl,
      profileImageStorageId: args.profileImageStorageId,
      profileImageUploadPath: args.profileImageUploadPath,
      portfolioImages: args.portfolioImages,
      portfolioImageStorageIds: args.portfolioImageStorageIds,
      specialties: args.specialties,
      background: args.background,
      socials: args.socials,
      isActive: args.isActive,
      isNew: args.isNew,
      createdAt: now,
      updatedAt: now,
    });
    return instructorId;
  },
});

export const uploadInstructorProfileImage = mutation({
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

export const addInstructorPortfolioImage = mutation({
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

export const adminListInstructors = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instructors").collect();
  },
});
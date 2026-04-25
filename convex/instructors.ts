import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

/** Returns the instructor matching the given userId, or null if not authenticated. */
export const getInstructorByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

/** Returns the instructor document by id, or null if not authenticated. */
export const getInstructorById = query({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

/** Returns non-deleted instructors matching the given ids. */
export const getInstructorsByIds = query({
  args: { ids: v.array(v.id("instructors")) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    
    const instructors = await Promise.all(
      args.ids.map((id) => ctx.db.get(id))
    );
    
    return instructors.filter((inst): inst is Doc<"instructors"> => inst !== null && !inst.deletedAt);
  },
});

/** Returns the instructor profile matching the given slug. */
export const getInstructorBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!profile) {
      return null;
    }
    return profile;
  },
});

/** Returns all non-deleted instructors. Requires authentication. */
export const listInstructors = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

/** Returns active instructors with inventory, excluding sensitive fields. Requires authentication. */
export const getActiveInstructors = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const instructors = await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .filter((q) => q.gt(q.field("oneOnOneInventory"), 0))
      .collect();
    return instructors.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns publicly available active instructors with inventory, excluding sensitive fields. */
export const getPublicInstructors = query({
  handler: async (ctx) => {
    const instructors = await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .filter((q) => q.gt(q.field("oneOnOneInventory"), 0))
      .collect();
    return instructors.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns all non-deleted instructors for admin with inventory data, excluding sensitive fields. */
export const getInstructorsForAdmin = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      return [];
    }
    const instructors = await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    return instructors.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns an instructor by slug from the instructors table (not instructorProfiles). */
export const getInstructorBySlugForAdmin = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      return null;
    }
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!instructor) {
      return null;
    }
    return instructor;
  },
});

/** Creates a new instructor or returns the existing instructor id if one already exists. */
export const createInstructor = mutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.optional(v.number()),
    bio: v.optional(v.string()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    
    if (existing) {
      return existing._id;
    }
    
    return await ctx.db.insert("instructors", {
      ...args,
      name: args.name ?? undefined,
      slug: args.slug ?? undefined,
      email: args.email ?? undefined,
      maxActiveStudents: args.maxActiveStudents ?? 10,
      oneOnOneInventory: args.oneOnOneInventory ?? 0,
      groupInventory: args.groupInventory ?? 0,
    });
  },
});

/** Updates the specified instructor fields and returns the updated document. */
export const updateInstructor = mutation({
  args: {
    id: v.id("instructors"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.optional(v.number()),
    bio: v.optional(v.string()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Soft-deletes an instructor by setting deletedAt to the current timestamp. */
export const deleteInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Decrements the oneOnOne or group inventory for an instructor by 1. */
export const decrementInventory = mutation({
  args: { 
    id: v.id("instructors"), 
    type: v.union(v.literal("oneOnOne"), v.literal("group")) 
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.id);
    if (!instructor) {
      throw new Error("Instructor not found");
    }
    
    const field = args.type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory";
    const currentValue = instructor[field] as number;
    
    if (currentValue <= 0) {
      throw new Error("No inventory available");
    }
    
    await ctx.db.patch(args.id, { [field]: currentValue - 1 });
    return await ctx.db.get(args.id);
  },
});

/** Increments the oneOnOne or group inventory for an instructor by 1. */
export const incrementInventory = mutation({
  args: { 
    id: v.id("instructors"), 
    type: v.union(v.literal("oneOnOne"), v.literal("group")) 
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.id);
    if (!instructor) {
      throw new Error("Instructor not found");
    }
    
    const field = args.type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory";
    const currentValue = instructor[field] as number;
    
    await ctx.db.patch(args.id, { [field]: currentValue + 1 });
    return await ctx.db.get(args.id);
  },
});

/** Creates a testimonial for an instructor profile. */
export const createTestimonial = mutation({
  args: {
    instructorId: v.id("instructors"),
    name: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("instructorTestimonials", {
      instructorId: args.instructorId,
      name: args.name,
      text: args.text,
    });
  },
});

/** Creates a mentee result with an image URL for an instructor profile. */
export const createMenteeResult = mutation({
  args: {
    instructorId: v.id("instructors"),
    imageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("menteeResults", {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
    });
  },
});

import { query, mutation, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

export const getStorageUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    return url;
  },
});

export const getMigrationStatus = query({
  args: {},
  handler: async (ctx) => {
    const instructors = await ctx.db.query("instructors").collect();
    const profiles = await ctx.db.query("instructorProfiles").collect();
    const menteeResults = await ctx.db.query("menteeResults").collect();

    const instructorsNeedingProfileMigration = instructors.filter(
      (i) => i.profileImageUrl && !i.profileImageStorageId
    ).length;

    const instructorsNeedingPortfolioMigration = instructors.filter(
      (i) => i.portfolioImages &&
      i.portfolioImages.length > 0 &&
      (!i.portfolioImageStorageIds || i.portfolioImageStorageIds.length < i.portfolioImages.length)
    ).length;

    const profilesNeedingProfileMigration = profiles.filter(
      (p) => p.profileImageUrl && !p.profileImageStorageId
    ).length;

    const profilesNeedingPortfolioMigration = profiles.filter(
      (p) => p.portfolioImages &&
      p.portfolioImages.length > 0 &&
      (!p.portfolioImageStorageIds || p.portfolioImageStorageIds.length < p.portfolioImages.length)
    ).length;

    const menteeResultsNeedingMigration = menteeResults.filter(
      (r) => r.imageUrl && !r.imageStorageId
    ).length;

    const instructorsWithStorageId = instructors.filter((i) => i.profileImageStorageId).length;
    const profilesWithStorageId = profiles.filter((p) => p.profileImageStorageId).length;

    return {
      instructorsNeedingProfileMigration,
      instructorsNeedingPortfolioMigration,
      profilesNeedingProfileMigration,
      profilesNeedingPortfolioMigration,
      menteeResultsNeedingMigration,
      instructorsWithStorageId,
      profilesWithStorageId,
      totalInstructors: instructors.length,
      totalProfiles: profiles.length,
      totalMenteeResults: menteeResults.length,
    };
  },
});

export const getInstructorByUserIdExternal = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

export const listInstructorsInternal = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
  },
});

export const listInstructorProfilesInternal = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instructorProfiles").collect();
  },
});

export const listMenteeResultsInternal = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("menteeResults").collect();
  },
});

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
    instructorId: v.id('instructors'),
    imageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('menteeResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
    });
  },
});

export const createMenteeResultWithStorage = mutation({
  args: {
    instructorId: v.id('instructors'),
    imageUrl: v.string(),
    imageStorageId: v.string(),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('menteeResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      imageStorageId: args.imageStorageId,
      studentName: args.studentName,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
  },
});

/** Idempotent upsert for instructor profiles, keyed on slug. */
export const upsertInstructorProfile = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.boolean(),
    isNew: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('instructorProfiles')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        tagline: args.tagline,
        bio: args.bio,
        specialties: args.specialties,
        background: args.background,
        profileImageUrl: args.profileImageUrl,
        portfolioImages: args.portfolioImages,
        socials: args.socials,
        isActive: args.isActive,
        isNew: args.isNew,
      });
      return existing._id;
    }

    return await ctx.db.insert('instructorProfiles', {
      slug: args.slug,
      name: args.name,
      tagline: args.tagline,
      bio: args.bio,
      specialties: args.specialties,
      background: args.background,
      profileImageUrl: args.profileImageUrl,
      portfolioImages: args.portfolioImages,
      socials: args.socials,
      isActive: args.isActive,
      isNew: args.isNew,
    });
  },
});

/** Idempotent upsert for instructor testimonials, keyed on instructorId + name + text. */
export const upsertInstructorTestimonial = mutation({
  args: {
    instructorId: v.string(),
    name: v.string(),
    text: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('instructorTestimonials')
      .withIndex('by_instructorId', (q) => q.eq('instructorId', args.instructorId))
      .filter((q) => q.and(
        q.eq(q.field('name'), args.name),
        q.eq(q.field('text'), args.text)
      ))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: args.role,
      });
      return existing._id;
    }

    return await ctx.db.insert('instructorTestimonials', {
      instructorId: args.instructorId,
      name: args.name,
      text: args.text,
      role: args.role,
    });
  },
});

/** Idempotent upsert for mentee results, keyed on instructorId + imageUrl. */
export const upsertMenteeResult = mutation({
  args: {
    instructorId: v.string(),
    imageUrl: v.string(),
    studentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('menteeResults')
      .withIndex('by_instructorId', (q) => q.eq('instructorId', args.instructorId))
      .filter((q) => q.eq(q.field('imageUrl'), args.imageUrl))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        studentName: args.studentName,
        createdAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert('menteeResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      studentName: args.studentName,
      createdAt: Date.now(),
    });
  },
});

type ImageType = "profile" | "portfolio" | "result";

function buildStorageKey(instructorSlug: string, type: ImageType, storageId: string): string {
  const typeFolder = type === "profile" ? "profile" : type === "portfolio" ? "portfolio" : "results";
  return `instructors/${instructorSlug}/${typeFolder}/${storageId}`;
}

export const generateInstructorUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const uploadInstructorProfileImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || !instructor.slug) {
      throw new Error("Instructor not found or missing slug");
    }

    const storageKey = buildStorageKey(instructor.slug, "profile", args.storageId);
    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);

    await ctx.db.patch(args.instructorId, {
      profileImageUrl: url ?? `convex://storage/${args.storageId}`,
      profileImageStorageId: args.storageId,
    });

    return { storageId: args.storageId, url, storageKey };
  },
});

export const uploadInstructorPortfolioImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    contentType: v.string(),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || !instructor.slug) {
      throw new Error("Instructor not found or missing slug");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);

    const currentPortfolio = instructor.portfolioImages ?? [];
    const currentStorageIds = instructor.portfolioImageStorageIds ?? [];

    const newPortfolioImages = [...currentPortfolio];
    const newStorageIds = [...currentStorageIds];

    while (newPortfolioImages.length <= args.index) {
      newPortfolioImages.push("");
      newStorageIds.push("");
    }

    newPortfolioImages[args.index] = url ?? `convex://storage/${args.storageId}`;
    newStorageIds[args.index] = args.storageId;

    await ctx.db.patch(args.instructorId, {
      portfolioImages: newPortfolioImages,
      portfolioImageStorageIds: newStorageIds,
    });

    return { storageId: args.storageId, url, index: args.index };
  },
});

export const uploadMenteeResultImage = mutation({
  args: {
    menteeResultId: v.id("menteeResults"),
    storageId: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const menteeResult = await ctx.db.get(args.menteeResultId);
    if (!menteeResult) {
      throw new Error("Mentee result not found");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);

    await ctx.db.patch(args.menteeResultId, {
      imageUrl: url ?? `convex://storage/${args.storageId}`,
      imageStorageId: args.storageId,
    });

    return { storageId: args.storageId, url };
  },
});

export const updateInstructorProfileImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    await ctx.db.patch(args.instructorId, {
      profileImageStorageId: args.storageId,
      profileImageUrl: url,
    });

    return { storageId: args.storageId, url };
  },
});

export const updateInstructorPortfolioImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    const currentStorageIds = instructor.portfolioImageStorageIds ?? [];
    const newStorageIds = [...currentStorageIds];

    while (newStorageIds.length <= args.index) {
      newStorageIds.push("");
    }
    newStorageIds[args.index] = args.storageId;

    const currentUrls = instructor.portfolioImages ?? [];
    const newUrls = [...currentUrls];
    while (newUrls.length <= args.index) {
      newUrls.push("");
    }
    newUrls[args.index] = url;

    await ctx.db.patch(args.instructorId, {
      portfolioImageStorageIds: newStorageIds,
      portfolioImages: newUrls,
    });

    return { storageId: args.storageId, url, index: args.index };
  },
});

export const updateInstructorProfileStorageId = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instructorId, {
      profileImageStorageId: args.storageId,
      profileImageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

export const updateInstructorPortfolioStorageIds = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageIds: v.array(v.string()),
    urls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instructorId, {
      portfolioImageStorageIds: args.storageIds,
      portfolioImages: args.urls,
    });
    return { storageIds: args.storageIds, urls: args.urls };
  },
});

export const updateMenteeResultStorageId = mutation({
  args: {
    menteeResultId: v.id("menteeResults"),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.menteeResultId, {
      imageStorageId: args.storageId,
      imageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

export const updateInstructorProfileStorageIdForProfile = mutation({
  args: {
    slug: v.string(),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!profile) {
      throw new Error("Instructor profile not found");
    }

    await ctx.db.patch(profile._id, {
      profileImageStorageId: args.storageId,
      profileImageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

export const updateInstructorPortfolioStorageIdsForProfile = mutation({
  args: {
    slug: v.string(),
    storageIds: v.array(v.string()),
    urls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!profile) {
      throw new Error("Instructor profile not found");
    }

    await ctx.db.patch(profile._id, {
      portfolioImageStorageIds: args.storageIds,
      portfolioImages: args.urls,
    });
    return { storageIds: args.storageIds, urls: args.urls };
  },
});

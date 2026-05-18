import { query, mutation, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

export const getStorageUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId as Id<"_storage">);
  },
});

async function getFreshProfileUrl(
  ctx: QueryCtx,
  storageId: string | undefined,
  fallbackUrl: string | undefined
): Promise<string | undefined> {
  if (!storageId) return fallbackUrl;
  const url = await ctx.storage.getUrl(storageId as Id<"_storage">);
  return url ?? fallbackUrl;
}

async function getFreshPortfolioUrls(
  ctx: QueryCtx,
  storageIds: string[] | undefined,
  fallbackUrls: string[] | undefined
): Promise<string[] | undefined> {
  if (!storageIds || storageIds.length === 0) return fallbackUrls;
  const urls = await Promise.all(
    storageIds.map(async (sid, i) => {
      if (!sid) return fallbackUrls?.[i];
      const url = await ctx.storage.getUrl(sid as Id<"_storage">);
      return url ?? fallbackUrls?.[i];
    })
  );
  return urls.filter((u): u is string => u !== undefined);
}

export const getMigrationStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const instructors = await ctx.db.query("instructors").collect();
    const profiles = await ctx.db.query("instructorProfiles").collect();

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

    const instructorsWithStorageId = instructors.filter((i) => i.profileImageStorageId).length;
    const profilesWithStorageId = profiles.filter((p) => p.profileImageStorageId).length;

    return {
      instructorsNeedingProfileMigration,
      instructorsNeedingPortfolioMigration,
      profilesNeedingProfileMigration,
      profilesNeedingPortfolioMigration,
      instructorsWithStorageId,
      profilesWithStorageId,
      totalInstructors: instructors.length,
      totalProfiles: profiles.length,
    };
  },
});

export const getInstructorByUserIdExternal = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    return Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
  },
});

export const listInstructorProfilesInternal = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    return await ctx.db.query("instructorProfiles").collect();
  },
});

export const listStudentResultsInternal = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    return await ctx.db.query("studentResults").collect();
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
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
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
    const instructor = await ctx.db.get(args.id);
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
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
    
    const filtered = instructors.filter((inst): inst is Doc<"instructors"> => inst !== null && !inst.deletedAt);
    return Promise.all(
      filtered.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
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
    const profileImageUrl = await getFreshProfileUrl(ctx, profile.profileImageStorageId, profile.profileImageUrl);
    const portfolioImages = await getFreshPortfolioUrls(ctx, profile.portfolioImageStorageIds, profile.portfolioImages);
    return { ...profile, profileImageUrl, portfolioImages };
  },
});

/** Returns all non-deleted instructors. Requires authentication. */
export const listInstructors = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    return Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
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
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.gt(q.field("oneOnOneInventory"), 0))
      .collect();
    const refreshed = await Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
    return refreshed.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns publicly available instructors (non-deleted), with a computed sold-out flag per their active offerings. */
export const getPublicInstructors = query({
  handler: async (ctx) => {
    // Fetch non-deleted instructors; then filter to public-visible ones only
    const all = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    const publicVisible = all.filter((inst) => (inst.isActive ?? false) && !(inst.isHidden ?? false));

    const refreshed = await Promise.all(
      publicVisible.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(
          ctx,
          inst.profileImageStorageId,
          inst.profileImageUrl
        );

        // Determine offered mentorship types from active products
        const products = await ctx.db
          .query("products")
          .withIndex("by_instructorId", (q) => q.eq("instructorId", inst._id))
          .collect();

        const activeProducts = products.filter((p) => p.active && !p.deletedAt);
        const offeredTypes = Array.from(
          new Set(
            activeProducts
              .map((p) => p.mentorshipType)
              .filter((t): t is string => typeof t === "string")
          )
        );

        let isCompletelySoldOut = false;
        if (offeredTypes.length > 0) {
          const oneOnOneInv = (inst as any).oneOnOneInventory ?? 0;
          const groupInv = (inst as any).groupInventory ?? 0;
          isCompletelySoldOut = offeredTypes.every((t) => {
            if (t === "one-on-one") return oneOnOneInv === 0;
            if (t === "group") return groupInv === 0;
            // Unknown type: treat as not sold out
            return false;
          });
        }

        return { ...inst, profileImageUrl, isCompletelySoldOut };
      })
    );

    // Strip sensitive fields
    return refreshed.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns all non-deleted instructors for admin with inventory data, excluding sensitive fields. */
export const getInstructorsForAdmin = query({
  handler: async (ctx) => {
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    const refreshed = await Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
    return refreshed.map(({ googleRefreshToken, ...rest }) => rest);
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
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
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
    tagline: v.optional(v.string()),
    background: v.optional(v.array(v.string())),
    specialties: v.optional(v.array(v.string())),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    
    if (existing) {
      return existing._id;
    }

    if (args.slug) {
      const existingBySlug = await ctx.db
        .query("instructors")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug!))
        .first();
      
      if (existingBySlug && existingBySlug.userId !== args.userId) {
        throw new Error("Slug already exists");
      }
    }
    
    return await ctx.db.insert("instructors", {
      userId: args.userId,
      name: args.name ?? undefined,
      slug: args.slug ?? undefined,
      email: args.email ?? undefined,
      tagline: args.tagline ?? undefined,
      background: args.background ?? undefined,
      portfolioImages: args.portfolioImages ?? undefined,
      socials: args.socials ?? undefined,
      isActive: args.isActive ?? true,
      isNew: args.isNew ?? true,
      profileImageUrl: args.profileImageUrl ?? undefined,
      profileImageUploadPath: args.profileImageUploadPath ?? undefined,
      profileImageStorageId: args.profileImageStorageId ?? undefined,
      maxActiveStudents: args.maxActiveStudents ?? 10,
      oneOnOneInventory: args.oneOnOneInventory ?? 0,
      groupInventory: args.groupInventory ?? 0,
    });
  },
});

export const migrateInstructor = mutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    bio: v.optional(v.string()),
    tagline: v.optional(v.string()),
    background: v.optional(v.array(v.string())),
    specialties: v.optional(v.array(v.string())),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    legacyInstructorRef: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.optional(v.number()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByUserId = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existingByUserId) {
      const updates: Partial<Doc<"instructors">> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.slug !== undefined) updates.slug = args.slug;
      if (args.email !== undefined) updates.email = args.email;
      if (args.bio !== undefined) updates.bio = args.bio;
      if (args.tagline !== undefined) updates.tagline = args.tagline;
      if (args.background !== undefined) updates.background = args.background;
      if (args.specialties !== undefined) updates.specialties = args.specialties;
      if (args.portfolioImages !== undefined) updates.portfolioImages = args.portfolioImages;
      if (args.socials !== undefined) updates.socials = args.socials;
      if (args.isActive !== undefined) updates.isActive = args.isActive;
      if (args.isNew !== undefined) updates.isNew = args.isNew;
      if (args.profileImageUrl !== undefined) updates.profileImageUrl = args.profileImageUrl;
      if (args.profileImageUploadPath !== undefined) updates.profileImageUploadPath = args.profileImageUploadPath;
      if (args.profileImageStorageId !== undefined) updates.profileImageStorageId = args.profileImageStorageId;
      if (args.legacyInstructorRef !== undefined) updates.legacyInstructorRef = args.legacyInstructorRef;
      if (args.googleCalendarId !== undefined) updates.googleCalendarId = args.googleCalendarId;
      if (args.googleRefreshToken !== undefined) updates.googleRefreshToken = args.googleRefreshToken;
      if (args.timeZone !== undefined) updates.timeZone = args.timeZone;
      if (args.workingHours !== undefined) updates.workingHours = args.workingHours;
      if (args.maxActiveStudents !== undefined) updates.maxActiveStudents = args.maxActiveStudents;
      if (args.pricing !== undefined) updates.pricing = args.pricing;
      if (args.oneOnOneInventory !== undefined) updates.oneOnOneInventory = args.oneOnOneInventory;
      if (args.groupInventory !== undefined) updates.groupInventory = args.groupInventory;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByUserId._id, updates);
      }
      return { action: "updated", id: existingByUserId._id };
    }

    const id = await ctx.db.insert("instructors", {
      userId: args.userId,
      name: args.name ?? undefined,
      slug: args.slug ?? undefined,
      email: args.email ?? undefined,
      bio: args.bio ?? undefined,
      tagline: args.tagline ?? undefined,
      background: args.background ?? undefined,
      specialties: args.specialties ?? undefined,
      portfolioImages: args.portfolioImages ?? undefined,
      socials: args.socials ?? undefined,
      isActive: args.isActive ?? true,
      isNew: args.isNew ?? true,
      profileImageUrl: args.profileImageUrl ?? undefined,
      profileImageUploadPath: args.profileImageUploadPath ?? undefined,
      profileImageStorageId: args.profileImageStorageId ?? undefined,
      legacyInstructorRef: args.legacyInstructorRef ?? undefined,
      googleCalendarId: args.googleCalendarId ?? undefined,
      googleRefreshToken: args.googleRefreshToken ?? undefined,
      timeZone: args.timeZone ?? undefined,
      workingHours: args.workingHours ?? undefined,
      maxActiveStudents: args.maxActiveStudents ?? 10,
      pricing: args.pricing ?? undefined,
      oneOnOneInventory: args.oneOnOneInventory ?? 0,
      groupInventory: args.groupInventory ?? 0,
    });

    return { action: "inserted", id };
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
    tagline: v.optional(v.string()),
    background: v.optional(v.array(v.string())),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    legacyInstructorRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
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

/** Creates a testimonial for an instructor profile. Admin role enforced. */
export const createTestimonial = mutation({
  args: {
    instructorId: v.id("instructors"),
    name: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const id = await ctx.db.insert("instructorTestimonials", {
      instructorId: args.instructorId,
      name: args.name,
      text: args.text,
      createdAt: Date.now(),
    });
    const testimonial = await ctx.db.get(id);
    if (!testimonial) throw new Error("Failed to create testimonial");
    return testimonial;
  },
});

/** Creates a student result with an image URL for an instructor profile. Admin role enforced. */
export const createStudentResult = mutation({
  args: {
    instructorId: v.id('instructors'),
    imageUrl: v.string(),
    imageUploadPath: v.optional(v.string()),
    studentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const id = await ctx.db.insert('studentResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      imageUploadPath: args.imageUploadPath,
      studentName: args.studentName,
    });
    const result = await ctx.db.get(id);
    if (!result) throw new Error("Failed to create student result");

    return result;
  },
});

export const createStudentResultWithStorage = mutation({
  args: {
    instructorId: v.id('instructors'),
    imageUrl: v.string(),
    imageStorageId: v.string(),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const id = await ctx.db.insert('studentResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      imageStorageId: args.imageStorageId,
      studentName: args.studentName,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
    const result = await ctx.db.get(id);
    if (!result) throw new Error("Failed to create student result");

    return result;
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

/** Idempotent upsert for student results, keyed on instructorId + imageUrl. */
export const upsertStudentResult = mutation({
  args: {
    instructorId: v.string(),
    imageUrl: v.string(),
    studentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('studentResults')
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

    const id = await ctx.db.insert('studentResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      studentName: args.studentName,
      createdAt: Date.now(),
    });

    return id;
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
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    await ctx.db.patch(args.instructorId, {
      profileImageUrl: url,
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
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    const currentPortfolio = instructor.portfolioImages ?? [];
    const currentStorageIds = instructor.portfolioImageStorageIds ?? [];

    const newPortfolioImages = [...currentPortfolio];
    const newStorageIds = [...currentStorageIds];

    while (newPortfolioImages.length <= args.index) {
      newPortfolioImages.push("");
      newStorageIds.push("");
    }

    newPortfolioImages[args.index] = url;
    newStorageIds[args.index] = args.storageId;

    await ctx.db.patch(args.instructorId, {
      portfolioImages: newPortfolioImages,
      portfolioImageStorageIds: newStorageIds,
    });

    return { storageId: args.storageId, url, index: args.index };
  },
});

export const uploadStudentResultImage = mutation({
  args: {
    studentResultId: v.id("studentResults"),
    storageId: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const studentResult = await ctx.db.get(args.studentResultId);
    if (!studentResult) {
      throw new Error("Student result not found");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    await ctx.db.patch(args.studentResultId, {
      imageUrl: url,
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    await ctx.db.patch(args.instructorId, {
      portfolioImageStorageIds: args.storageIds,
      portfolioImages: args.urls,
    });
    return { storageIds: args.storageIds, urls: args.urls };
  },
});

export const updateStudentResultStorageId = mutation({
  args: {
    studentResultId: v.id("studentResults"),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const studentResult = await ctx.db.get(args.studentResultId);
    if (!studentResult) throw new Error("Student result not found");

    await ctx.db.patch(args.studentResultId, {
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
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

/** Returns all testimonials for a given instructor. */
export const getTestimonialsByInstructorId = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("instructorTestimonials")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns all student results for a given instructor. */
export const getStudentResultsByInstructorId = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("studentResults")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns a testimonial by ID, or null if not found/not owned by instructor. */
export const getTestimonialById = query({
  args: { id: v.id("instructorTestimonials"), instructorId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const testimonial = await ctx.db.get(args.id);
    if (!testimonial || testimonial.instructorId !== args.instructorId) {
      return null;
    }
    return testimonial;
  },
});

export const getStudentResultById = query({
  args: { id: v.id("studentResults"), instructorId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const result = await ctx.db.get(args.id);
    if (!result || result.instructorId !== args.instructorId) {
      return null;
    }
    return result;
  },
});

/** Updates instructor scheduling settings (timeZone and workingHours). Requires admin role or self. */
export const updateInstructorSchedulingSettings = mutation({
  args: {
    id: v.id("instructors"),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    
    if (!user || (user.role !== "admin" && user.role !== "instructor")) {
      throw new Error("Forbidden");
    }
    
    if (user.role === "instructor") {
      const instructor = await ctx.db.get(args.id);
      if (!instructor || instructor.userId !== identity.subject) {
        throw new Error("Forbidden");
      }
    }
    
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Returns students with session pack info for an instructor. */
export const getInstructorStudentsWithSessionInfo = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    
    const sessionPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
    
    const studentsMap = new Map<string, {
      userId: string;
      sessionPackId: string;
      totalSessions: number;
      remainingSessions: number;
      expiresAt: number | null;
      status: string;
    }>();
    
    for (const pack of sessionPacks) {
      if (!studentsMap.has(pack.userId) || pack.status === "active") {
        studentsMap.set(pack.userId, {
          userId: pack.userId,
          sessionPackId: pack._id,
          totalSessions: pack.totalSessions,
          remainingSessions: pack.remainingSessions,
          expiresAt: pack.expiresAt ?? null,
          status: pack.status,
        });
      }
    }
    
    const result = await Promise.all(
      Array.from(studentsMap.values()).map(async (m) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", m.userId))
          .first();
        
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_studentId", (q) => q.eq("studentId", m.userId))
.filter((q) => q.eq(q.field("instructorId"), args.instructorId))
          .collect();
        
        const completedSessions = sessions.filter(s => s.status === "completed");
        const lastSession = completedSessions.length > 0
          ? completedSessions.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]
          : null;
        
        return {
          userId: m.userId,
          email: user?.email ?? null,
          sessionPackId: m.sessionPackId,
          totalSessions: m.totalSessions,
          remainingSessions: m.remainingSessions,
          expiresAt: m.expiresAt,
          status: m.status,
          lastSessionCompletedAt: lastSession?.completedAt ?? null,
          completedSessionCount: completedSessions.length,
        };
      })
    );
    
    return result;
  },
});

/** Returns the session count for a user's session pack with an instructor. */
export const getUserSessionCountForInstructor = query({
  args: { userId: v.string(), instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    
    const sessionPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();
    
    if (sessionPacks.length === 0) {
      return null;
    }
    
    const activePacks = sessionPacks.filter(p => p.status === "active");
    const pack = activePacks.length > 0 ? activePacks[0] : sessionPacks[0];
    
    return {
      sessionPackId: pack._id,
      totalSessions: pack.totalSessions,
      remainingSessions: pack.remainingSessions,
      expiresAt: pack.expiresAt ?? null,
      status: pack.status,
    };
  },
});

export const getInstructorByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .collect();
  },
});

export const getPendingStudentInvitationsByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const invitations = await ctx.db
      .query("studentInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .collect();

    return invitations.filter(
      inv => inv.status === "pending" && inv.expiresAt > now
    );
  },
});

/** Deletes a testimonial by ID. Requires admin role or instructor ownership. */
export const deleteTestimonial = mutation({
  args: { id: v.id("instructorTestimonials") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    
    if (!user || (user.role !== "admin" && user.role !== "instructor")) {
      throw new Error("Forbidden");
    }
    
    const testimonial = await ctx.db.get(args.id);
    if (!testimonial) throw new Error("Testimonial not found");
    
    if (user.role === "instructor") {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      if (!instructor || instructor._id !== testimonial.instructorId) {
        throw new Error("Forbidden");
      }
    }
    
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

/** Deletes a student result by ID. Requires admin role or instructor ownership. */
export const deleteStudentResult = mutation({
  args: { id: v.id("studentResults") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    
    if (!user || (user.role !== "admin" && user.role !== "instructor")) {
      throw new Error("Forbidden");
    }
    
    const studentResult = await ctx.db.get(args.id);
    if (!studentResult) throw new Error("Student result not found");
    
    if (user.role === "instructor") {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      if (!instructor || instructor._id !== studentResult.instructorId) {
        throw new Error("Forbidden");
      }
    }
    
    await ctx.db.delete(args.id);

    return { success: true };
  },
});

/** Checks seat availability for an instructor (public endpoint). */
export const checkSeatAvailability = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    const activeSeats = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId_status", (q) =>
        q.eq("instructorId", args.instructorId).eq("status", "active")
      )
      .collect();

    const maxSeats = instructor.oneOnOneInventory ?? 0;
    const activeCount = activeSeats.length;
    const remainingSeats = Math.max(0, maxSeats - activeCount);

    return {
      available: remainingSeats > 0,
      activeSeats: activeCount,
      maxSeats,
      remainingSeats,
    };
  },
});

/** Updates inventory fields for an instructor. Requires admin role. */
export const updateInstructorInventory = mutation({
  args: {
    id: v.id("instructors"),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
    maxActiveStudents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const { id, ...updates } = args;
    const filteredUpdates: Record<string, number> = {};
    if (updates.oneOnOneInventory !== undefined) filteredUpdates.oneOnOneInventory = updates.oneOnOneInventory;
    if (updates.groupInventory !== undefined) filteredUpdates.groupInventory = updates.groupInventory;
    if (updates.maxActiveStudents !== undefined) filteredUpdates.maxActiveStudents = updates.maxActiveStudents;

    if (Object.keys(filteredUpdates).length === 0) {
      throw new Error("No valid fields to update");
    }

    await ctx.db.patch(id, { ...filteredUpdates, updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const unlinkInstructorByUserId = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!instructor) {
      return { unlinked: false, reason: "No instructor found with matching userId", userId: args.userId };
    }

    await ctx.db.patch(instructor._id, { userId: undefined, updatedAt: Date.now() });
    return {
      unlinked: true,
      instructorId: instructor._id,
      instructorName: instructor.name ?? null,
      userId: args.userId,
    };
  },
});

type UnlinkInstructorResult =
  | { unlinked: true; instructorId: Id<"instructors">; instructorName: string | null; userId: string }
  | { unlinked: false; reason: string; userId: string };

export const unlinkClerkUserFromInstructor = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<UnlinkInstructorResult> => {
    const result = await ctx.runMutation(internal.instructors.unlinkInstructorByUserId, { userId: args.userId });
    return result as UnlinkInstructorResult;
  },
});

export const linkInstructorToLegacyMentor = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    legacyInstructorRef: v.optional(v.string()),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {
      userId: args.userId,
      updatedAt: Date.now(),
    };
    if (args.legacyInstructorRef) {
      updates.legacyInstructorRef = args.legacyInstructorRef;
    }
    await ctx.db.patch(args.instructorId, updates);
    return { success: true };
  },
});

export const acceptStudentInvitation = internalMutation({
  args: {
    email: v.string(),
    instructorId: v.id("instructors"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const invitation = await ctx.db
      .query("studentInvitations")
      .withIndex("by_email_instructorId", (q) =>
        q.eq("email", args.email.toLowerCase()).eq("instructorId", args.instructorId)
      )
      .filter((q) => q.and(
        q.eq(q.field("status"), "pending"),
        q.gt(q.field("expiresAt"), now)
      ))
      .first();

    if (!invitation) {
      return { accepted: false, reason: "No pending invitation found" };
    }

    await ctx.db.patch(invitation._id, {
      status: "accepted",
    });

    return { accepted: true, invitationId: invitation._id };
  },
});

type LinkResult = {
  linked: boolean;
  reason?: string;
  instructorId?: Id<"instructors">;
  instructorName?: string | null;
  legacyInstructorRef?: string;
  email?: string;
  userId?: string;
  invitationId?: Id<"studentInvitations">;
  needsSessionPack?: boolean;
};

export const linkClerkUserToInstructor = internalAction({
  args: {
    userId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args): Promise<{ instructorLinking: LinkResult; studentLinking: LinkResult }> => {
    const { userId, email } = args;

    if (!email || typeof email !== "string") {
      return {
        instructorLinking: { linked: false, reason: "No email provided" },
        studentLinking: { linked: false, reason: "No email provided" },
      };
    }

    const normalizedEmail = email.toLowerCase();

    const instructorsWithEmail = await ctx.runQuery(
      internal.instructors.getInstructorByEmailInternal,
      { email: normalizedEmail }
    );

    let instructorResult: LinkResult = { linked: false, reason: "No instructor found with matching email", email };

    if (instructorsWithEmail.length > 0) {
      const instructor = instructorsWithEmail[0];

      if (instructor.userId && instructor.userId !== userId) {
        instructorResult = { linked: false, reason: "Instructor already linked to a different Clerk user", instructorId: instructor._id };
      } else {
        await ctx.runMutation(internal.instructors.linkInstructorToLegacyMentor, {
          instructorId: instructor._id,
          legacyInstructorRef: instructor.legacyInstructorRef,
          userId,
        });

        instructorResult = {
          linked: true,
          instructorId: instructor._id,
          instructorName: instructor.name ?? null,
          userId,
          legacyInstructorRef: instructor.legacyInstructorRef ?? undefined,
          email,
        };
      }
    }

    const pendingInvitations = await ctx.runQuery(
      internal.instructors.getPendingStudentInvitationsByEmail,
      { email: normalizedEmail }
    );

    let studentResult: LinkResult = { linked: false, reason: "No pending student invitation found", email };

    if (pendingInvitations.length > 0) {
      const pendingInvitation = pendingInvitations[0];
      await ctx.runMutation(internal.instructors.acceptStudentInvitation, {
        email: normalizedEmail,
        instructorId: pendingInvitation.instructorId,
      });

      studentResult = {
        linked: true,
        invitationId: pendingInvitation._id,
        legacyInstructorRef: pendingInvitation.instructorId.toString(),
        email,
        needsSessionPack: true,
      };
    }

    return {
      instructorLinking: instructorResult,
      studentLinking: studentResult,
    };
  },
});

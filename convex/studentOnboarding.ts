import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

async function getSignedUrlsForStorageIds(
  ctx: { storage: { getUrl(id: Id<"_storage">): Promise<string | null> } },
  storageIds: (Id<"_storage"> | string)[] | undefined
): Promise<Array<{ storageId: string; signedUrl: string }>> {
  if (!storageIds || storageIds.length === 0) return [];
  const results = await Promise.all(
    storageIds.map(async (storageId) => {
      const signedUrl = await ctx.storage.getUrl(storageId as Id<"_storage">);
      if (!signedUrl) return null;
      return { storageId: storageId as string, signedUrl };
    })
  );
  return results.filter((r): r is { storageId: string; signedUrl: string } => r !== null);
}

/**
 * Fetches a student onboarding submission by its legacy ID (UUID used by the web app).
 * Returns null if not found.
 */
export const getByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("studentOnboardingSubmissions")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();
  },
});

/**
 * Creates a new student onboarding submission.
 * No auth check - intended to be called from server-side migration scripts only.
 * Idempotent: if a submission with the same legacyId exists, returns the existing record without creating a new one.
 * Maps the session pack's legacyId to its Convex ID.
 */
export const create = mutation({
  args: {
    legacyId: v.string(),
    userId: v.string(),
    instructorId: v.id("instructors"),
    sessionPackId: v.string(),
    goals: v.string(),
    imageObjects: v.optional(v.any()),
    imageStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    // Idempotency: if already exists, no-op
    const existing = await ctx.db
      .query("studentOnboardingSubmissions")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
      .first();
    if (existing) return { id: existing._id, legacyId: existing.legacyId };

    // Map sessionPack legacyId → Convex Id
    const sp = await ctx.db
      .query("sessionPacks")
      .filter((q) => q.eq(q.field("legacyId"), args.sessionPackId))
      .first();
    if (!sp) {
      throw new Error("sessionPack not found for provided legacy id");
    }

    const now = Date.now();
    const id = await ctx.db.insert("studentOnboardingSubmissions", {
      legacyId: args.legacyId,
      userId: args.userId,
      instructorId: args.instructorId,
      sessionPackId: sp._id,
      goals: args.goals,
      imageObjects: args.imageObjects,
      imageStorageIds: args.imageStorageIds,
      createdAt: now,
      updatedAt: now,
    });
    return { id, legacyId: args.legacyId };
  },
});

/**
 * Marks a student onboarding submission as reviewed.
 * Only succeeds if the submission belongs to the specified instructor.
 * Returns error if submission not found or instructor mismatch.
 */
export const markReviewed = mutation({
  args: {
    legacyId: v.string(),
    instructorId: v.id("instructors"),
    reviewedByUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("studentOnboardingSubmissions")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();
    if (!sub) return { ok: false as const, error: "not_found" };
    if (sub.instructorId !== args.instructorId) return { ok: false as const, error: "forbidden" };

    await ctx.db.patch(sub._id, {
      reviewedAt: Date.now(),
      reviewedByUserId: args.reviewedByUserId,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const listByInstructor = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }
    if (instructor.userId !== user.subject) {
      throw new Error("Forbidden");
    }

    const submissions = await ctx.db
      .query("studentOnboardingSubmissions")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();

    const out: Array<{
      _id: Id<"studentOnboardingSubmissions">;
      legacyId: string | undefined;
      userId: string;
      goals: string;
      imageObjects: any;
      imageStorageIds: (Id<"_storage"> | string)[] | undefined;
      createdAt: number | undefined;
      reviewedAt: number | undefined;
      studentEmail: string;
    }> = [];

    for (const sub of submissions) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", sub.userId))
        .first();
      out.push({
        _id: sub._id,
        legacyId: sub.legacyId,
        userId: sub.userId,
        goals: sub.goals,
        imageObjects: sub.imageObjects,
        imageStorageIds: sub.imageStorageIds,
        createdAt: sub.createdAt,
        reviewedAt: sub.reviewedAt,
        studentEmail: user?.email ?? "unknown",
      });
    }

    out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return out;
  },
});

/**
 * Returns signed URLs for the Convex Storage IDs associated with a submission.
 * Falls back to an empty array if the submission or its storage IDs are missing.
 */
export const getSignedUrls = query({
  args: {
    submissionId: v.id("studentOnboardingSubmissions"),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) return [];
    return await getSignedUrlsForStorageIds(ctx, submission.imageStorageIds);
  },
});

/**
 * Returns signed URLs for an arbitrary list of Convex Storage IDs.
 * Useful for callers that already have the storage IDs (e.g. from Postgres)
 * and only need signed URLs.
 */
export const getSignedUrlsByStorageIds = query({
  args: {
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await getSignedUrlsForStorageIds(ctx, args.storageIds);
  },
});

/**
 * Generates a Convex Storage upload URL for onboarding images.
 * Called from the Next.js upload route so the server can stream the bytes
 * to Convex Storage and store the resulting storageId.
 */
export const generateImageUploadUrl = action({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

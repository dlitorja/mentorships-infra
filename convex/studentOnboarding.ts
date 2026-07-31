import { query, mutation, action } from "./_generated/server";
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Returns true if the authenticated user has the admin role in the users table.
 */
async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

/**
 * Returns the authenticated user identity or throws "Unauthorized".
 */
async function requireIdentity(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return identity;
}

/**
 * Returns true if the given userId is the student owner of the submission,
 * or if the authenticated user is the instructor assigned to the submission,
 * or if the authenticated user is an admin.
 */
async function canViewSubmission(
  ctx: QueryCtx,
  submission: { userId: string; instructorId: Id<"instructors"> },
  viewerUserId: string
): Promise<boolean> {
  if (submission.userId === viewerUserId) return true;
  if (await isAdminUser(ctx, viewerUserId)) return true;

  const instructor = await ctx.db.get(submission.instructorId);
  if (instructor?.userId === viewerUserId) return true;
  return false;
}

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
 * Requires an authenticated user and enforces that the authenticated user is the
 * student owner (args.userId matches the authenticated Clerk subject).
 *
 * Idempotent: if a submission with the same legacyId exists, returns the
 * existing record without creating a new one.
 *
 * Maps the session pack's legacyId to its Convex ID. Validates that the
 * provided imageStorageIds were recorded by the upload flow for this submission.
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
    const identity = await requireIdentity(ctx);
    if (args.userId !== identity.subject) {
      throw new Error("Forbidden: userId must match authenticated user");
    }

    // Idempotency: if already exists, no-op
    const existing = await ctx.db
      .query("studentOnboardingSubmissions")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
      .first();
    if (existing) return { id: existing._id, legacyId: existing.legacyId };

    // Map sessionPack legacyId -> Convex Id
    const sp = await ctx.db
      .query("sessionPacks")
      .filter((q) => q.eq(q.field("legacyId"), args.sessionPackId))
      .first();
    if (!sp) {
      throw new Error("sessionPack not found for provided legacy id");
    }

    // Verify the provided storageIds were recorded by the authenticated upload flow.
    const uploadRecord = await ctx.db
      .query("studentOnboardingUploadRecords")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();
    const expectedIds = new Set(uploadRecord?.storageIds ?? []);
    const submittedIds = args.imageStorageIds ?? [];
    if (submittedIds.length > 0) {
      const allRecorded = submittedIds.every((id) => expectedIds.has(id));
      if (!allRecorded) {
        throw new Error("Invalid storageIds: not all images were uploaded for this submission");
      }
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
 * Records the storage IDs uploaded for an onboarding submission.
 * Requires authentication. The record is keyed by the submission's legacyId and
 * stores the authenticated user's ID so the submit route can verify ownership.
 */
export const recordUpload = mutation({
  args: {
    legacyId: v.string(),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("studentOnboardingUploadRecords")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        storageIds: args.storageIds,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("studentOnboardingUploadRecords", {
        legacyId: args.legacyId,
        userId: identity.subject,
        storageIds: args.storageIds,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { ok: true as const };
  },
});

/**
 * Verifies that the provided storageIds were recorded for the given submission
 * by the authenticated user. Returns the validated, recorded storageIds when valid.
 * Requires authentication.
 */
export const verifyUpload = query({
  args: {
    legacyId: v.string(),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const record = await ctx.db
      .query("studentOnboardingUploadRecords")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();
    if (!record || record.userId !== identity.subject) return { valid: false as const };

    const expectedIds = new Set(record.storageIds);
    const valid = args.storageIds.length > 0 && args.storageIds.every((id) => expectedIds.has(id));
    return { valid, storageIds: record.storageIds };
  },
});

/**
 * Deletes a list of Convex Storage objects.
 * Intended for cleaning up partial uploads when a batch fails.
 * Requires authentication.
 */
export const deleteStorageObjects = action({
  args: {
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    for (const storageId of args.storageIds) {
      await ctx.storage.delete(storageId);
    }
    return { ok: true as const };
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

/**
 * Lists all onboarding submissions for a given instructor.
 * Requires authentication and that the authenticated user is the instructor.
 */
export const listByInstructor = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }
    if (instructor.userId !== identity.subject) {
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
 * Requires authentication and that the caller is the student owner, the assigned
 * instructor, or an admin.
 */
export const getSignedUrls = query({
  args: {
    submissionId: v.id("studentOnboardingSubmissions"),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) return [];
    const allowed = await canViewSubmission(ctx, submission, identity.subject);
    if (!allowed) {
      throw new Error("Forbidden");
    }
    return await getSignedUrlsForStorageIds(ctx, submission.imageStorageIds);
  },
});

/**
 * Returns signed URLs for the Convex Storage IDs associated with a submission
 * identified by its legacy ID. This is used by the legacy web app where the
 * Postgres record is the source of truth.
 *
 * Requires authentication and that the caller is the student owner, the assigned
 * instructor, or an admin.
 */
export const getSignedUrlsByLegacyId = query({
  args: {
    legacyId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const submission = await ctx.db
      .query("studentOnboardingSubmissions")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();
    if (!submission) return [];
    const allowed = await canViewSubmission(ctx, submission, identity.subject);
    if (!allowed) {
      throw new Error("Forbidden");
    }
    return await getSignedUrlsForStorageIds(ctx, submission.imageStorageIds);
  },
});

/**
 * Generates a Convex Storage upload URL for onboarding images.
 * Called from the authenticated Next.js upload route so the server can stream
 * the bytes to Convex Storage. Requires authentication.
 */
export const generateImageUploadUrl = action({
  args: {},
  handler: async (ctx) => {
    await requireIdentity(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Returns signed URLs for an arbitrary list of Convex Storage IDs.
 * Requires authentication.
 *
 * ⚠️ This is intended for trusted internal callers (e.g. admin tools) because it
 * does not verify ownership of the underlying storage objects.
 */
export const getSignedUrlsByStorageIds = query({
  args: {
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    return await getSignedUrlsForStorageIds(ctx, args.storageIds);
  },
});

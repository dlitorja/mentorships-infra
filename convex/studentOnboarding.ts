import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get a submission by its legacyId (UUID used by the web app)
export const getByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("studentOnboardingSubmissions")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
      .collect();
    return docs[0] ?? null;
  },
});

// Create a submission with provided legacyId and imageObjects
export const create = mutation({
  args: {
    legacyId: v.string(),
    userId: v.string(),
    instructorId: v.id("instructors"),
    sessionPackId: v.string(),
    goals: v.string(),
    imageObjects: v.any(),
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
      createdAt: now,
      updatedAt: now,
    });
    return { id, legacyId: args.legacyId };
  },
});

// Mark a submission reviewed if it belongs to the given instructor
export const markReviewed = mutation({
  args: {
    legacyId: v.string(),
    instructorId: v.id("instructors"),
    reviewedByUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("studentOnboardingSubmissions")
      .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
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

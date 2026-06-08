import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

type StudentSessionCountWithDetails = {
  id: Id<"studentSessionCounts">;
  userId: string;
  instructorId: Id<"instructors">;
  sessionCount: number;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  instructorName: string | null;
  instructorSlug: string | null;
};

/**
 * Fetches all session counts for a student across all instructors.
 * Only accessible by admin users.
 * Returns session counts with instructor details.
 */
export const getSessionCountsForStudent = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) return [];

    const counts = await ctx.db
      .query("studentSessionCounts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const results: StudentSessionCountWithDetails[] = await Promise.all(
      counts.map(async (count) => {
        const instructor = await ctx.db.get(count.instructorId);
        return {
          id: count._id,
          userId: count.userId,
          instructorId: count.instructorId,
          sessionCount: count.sessionCount,
          notes: count.notes ?? null,
          createdAt: count.createdAt,
          updatedAt: count.updatedAt,
          instructorName: instructor?.name ?? null,
          instructorSlug: instructor?.slug ?? null,
        };
      })
    );

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/**
 * Creates or updates a session count for a student with a specific instructor.
 * Requires admin authentication.
 */
export const upsertSessionCount = mutation({
  args: {
    userId: v.string(),
    instructorId: v.id("instructors"),
    sessionCount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");

    const existing = await ctx.db
      .query("studentSessionCounts")
      .withIndex("by_userId_instructorId", (q) =>
        q.eq("userId", args.userId).eq("instructorId", args.instructorId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionCount: args.sessionCount,
        notes: args.notes ?? existing.notes,
        updatedAt: Date.now(),
      });
      const updated = await ctx.db.get(existing._id);
      if (!updated) throw new Error("Failed to update session count");
      return updated;
    }

    const now = Date.now();
    const id = await ctx.db.insert("studentSessionCounts", {
      userId: args.userId,
      instructorId: args.instructorId,
      sessionCount: args.sessionCount,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });

    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error("Failed to create session count");
    return inserted;
  },
});

/**
 * Updates the session count and optional notes for an existing record.
 * Requires admin authentication.
 */
export const updateSessionCount = mutation({
  args: {
    id: v.id("studentSessionCounts"),
    sessionCount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");

    const existing = await ctx.db.get(args.id);
    if (!existing) return null;

    const updates: Partial<Doc<"studentSessionCounts">> = {
      sessionCount: args.sessionCount,
      updatedAt: Date.now(),
    };
    if (args.notes !== undefined) {
      updates.notes = args.notes;
    }

    await ctx.db.patch(args.id, updates);
    const updated = await ctx.db.get(args.id);
    return updated;
  },
});

/**
 * Adjusts a session count by a given amount (positive or negative).
 * Prevents count from going below zero.
 * Requires admin authentication.
 */
export const adjustSessionCount = mutation({
  args: {
    id: v.id("studentSessionCounts"),
    adjustment: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");

    const existing = await ctx.db.get(args.id);
    if (!existing) return null;

    const newCount = Math.max(existing.sessionCount + args.adjustment, 0);
    const updates: Partial<Doc<"studentSessionCounts">> = {
      sessionCount: newCount,
      updatedAt: Date.now(),
    };
    if (args.notes !== undefined) {
      updates.notes = args.notes;
    }

    await ctx.db.patch(args.id, updates);
    const updated = await ctx.db.get(args.id);
    return updated;
  },
});

/**
 * Deletes a session count record by ID.
 * Requires admin authentication.
 */
export const deleteSessionCount = mutation({
  args: { id: v.id("studentSessionCounts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");

    const existing = await ctx.db.get(args.id);
    if (!existing) return false;

    await ctx.db.delete(args.id);
    return true;
  },
});

/**
 * Migrates a session count from legacy system.
 * Updates existing record if found by userId and instructorId, otherwise creates new.
 */
export const migrateSessionCount = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    instructorId: v.id("instructors"),
    sessionCount: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByUserInstructor = await ctx.db
      .query("studentSessionCounts")
      .withIndex("by_userId_instructorId", (q) =>
        q.eq("userId", args.userId).eq("instructorId", args.instructorId)
      )
      .first();

    if (existingByUserInstructor) {
      const updates: Record<string, unknown> = {};
      if (args.sessionCount !== undefined) updates.sessionCount = args.sessionCount;
      if (args.notes !== undefined) updates.notes = args.notes;
      if (args.updatedAt) updates.updatedAt = args.updatedAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByUserInstructor._id, updates);
      }
      return { action: "updated", id: existingByUserInstructor._id };
    }

    const insertResult = await ctx.db.insert("studentSessionCounts", {
      userId: args.userId,
      instructorId: args.instructorId,
      sessionCount: args.sessionCount,
      notes: args.notes ?? undefined,
      createdAt: args.createdAt ?? Date.now(),
      updatedAt: args.updatedAt ?? Date.now(),
    });

    return { action: "inserted", id: insertResult };
  },
});

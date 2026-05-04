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

type MenteeSessionCountWithDetails = {
  id: Id<"menteeSessionCounts">;
  userId: string;
  instructorId: Id<"instructors">;
  sessionCount: number;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  instructorName: string | null;
  instructorSlug: string | null;
};

export const getSessionCountsForMentee = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) return [];

    const counts = await ctx.db
      .query("menteeSessionCounts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const results: MenteeSessionCountWithDetails[] = await Promise.all(
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
      .query("menteeSessionCounts")
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
    const id = await ctx.db.insert("menteeSessionCounts", {
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

export const updateSessionCount = mutation({
  args: {
    id: v.id("menteeSessionCounts"),
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

    const updates: Partial<Doc<"menteeSessionCounts">> = {
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

export const adjustSessionCount = mutation({
  args: {
    id: v.id("menteeSessionCounts"),
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
    const updates: Partial<Doc<"menteeSessionCounts">> = {
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

export const deleteSessionCount = mutation({
  args: { id: v.id("menteeSessionCounts") },
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
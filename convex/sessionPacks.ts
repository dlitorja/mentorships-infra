import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/** Returns a session pack by its ID, or null if not authenticated. */
export const getSessionPackById = query({
  args: { id: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

/** Returns all session packs belonging to a given user. */
export const getUserSessionPacks = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

/** Returns active, non-expired session packs for a given user. */
export const getUserActiveSessionPacks = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const now = Date.now();
    return await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId_status_expiresAt", (q) =>
        q.eq("userId", args.userId).eq("status", "active")
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("expiresAt"), undefined),
          q.gt(q.field("expiresAt"), now)
        )
      )
      .collect();
  },
});

/** Returns active session packs for a user with instructor information included. Used by student dashboard. */
export const getUserSessionPacksWithInstructors = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const limit = args.limit ?? 100;
    const offset = args.offset ?? 0;
    const now = Date.now();

    const packs = await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId_status_expiresAt", (q) =>
        q.eq("userId", args.userId).eq("status", "active")
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("expiresAt"), undefined),
          q.gt(q.field("expiresAt"), now)
        )
      )
      .collect();

    const sortedPacks = packs.sort((a, b) => b._creationTime - a._creationTime);
    const paginatedPacks = sortedPacks.slice(offset, offset + limit);

    const packsWithInstructors = await Promise.all(
      paginatedPacks.map(async (pack) => {
        const instructor = await ctx.db.get(pack.instructorId);
        let instructorUser = null;
        if (instructor?.userId) {
          const userId = instructor.userId;
          const users = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
          instructorUser = users;
        }

        return {
          id: pack._id,
          userId: pack.userId,
          instructorId: pack.instructorId,
          totalSessions: pack.totalSessions,
          remainingSessions: pack.remainingSessions,
          status: pack.status,
          purchasedAt: pack.purchasedAt,
          expiresAt: pack.expiresAt,
          paymentId: pack.paymentId,
          instructor: instructor ? {
            id: instructor._id,
            userId: instructor.userId,
            name: instructor.name,
            bio: instructor.bio,
            tagline: instructor.tagline,
            profileImageUrl: instructor.profileImageStorageId
              ? (await ctx.storage.getUrl(instructor.profileImageStorageId as Id<"_storage">)) ?? instructor.profileImageUrl
              : instructor.profileImageUrl,
          } : null,
          instructorUser: instructorUser ? {
            email: instructorUser.email,
          } : null,
        };
      })
    );

    return {
      items: packsWithInstructors,
      total: packs.length,
      limit,
      offset,
    };
  },
});

/** Returns the total remaining sessions for a user across all active packs. Used by student dashboard stats. */
export const getUserTotalRemainingSessions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const now = Date.now();
    const packs = await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId_status_expiresAt", (q) =>
        q.eq("userId", args.userId).eq("status", "active")
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("expiresAt"), undefined),
          q.gt(q.field("expiresAt"), now)
        )
      )
      .collect();

    const total = packs.reduce((sum, pack) => sum + (pack.remainingSessions || 0), 0);
    return total;
  },
});

/** Returns all session packs associated with a given instructor. */
export const getInstructorSessionPacks = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("sessionPacks")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns the session pack linked to a specific payment. */
export const getSessionPackByPaymentId = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("sessionPacks")
      .withIndex("by_paymentId", (q) => q.eq("paymentId", args.paymentId))
      .first();
  },
});

/** Creates a new session pack for a user and instructor. */
export const createSessionPack = mutation({
  args: {
    userId: v.string(),
    instructorId: v.id("instructors"),
    totalSessions: v.optional(v.number()),
    remainingSessions: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    paymentId: v.id("payments"),
  },
  handler: async (ctx, args) => {
    const totalSessions = args.totalSessions ?? 4;
    const id = await ctx.db.insert("sessionPacks", {
      userId: args.userId,
      instructorId: args.instructorId,
      totalSessions,
      remainingSessions: args.remainingSessions ?? totalSessions,
      purchasedAt: Date.now(),
      expiresAt: args.expiresAt,
      status: "active",
      paymentId: args.paymentId,
    });
    return await ctx.db.get(id);
  },
});

/** Updates remaining sessions, expiration, or status of a session pack. */
export const updateSessionPack = mutation({
  args: {
    id: v.id("sessionPacks"),
    remainingSessions: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("depleted"), v.literal("expired"), v.literal("refunded"))),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Decrements remaining sessions and marks the pack as depleted when zero. */
export const useSession = mutation({
  args: { id: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.id);
    if (!pack) {
      throw new Error("Session pack not found");
    }
    
    if (pack.remainingSessions <= 0) {
      throw new Error("No sessions remaining");
    }
    
    const newRemaining = pack.remainingSessions - 1;
    const newStatus = newRemaining <= 0 ? "depleted" : pack.status;
    
    await ctx.db.patch(args.id, {
      remainingSessions: newRemaining,
      status: newStatus,
    });
    
    return await ctx.db.get(args.id);
  },
});

/** Marks a session pack as refunded. */
export const refundSessionPack = mutation({
  args: { id: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "refunded" });
    return await ctx.db.get(args.id);
  },
});

/** Marks a session pack as expired. */
export const expireSessionPack = mutation({
  args: { id: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "expired" });
    return await ctx.db.get(args.id);
  },
});

/** Bulk-updates all active packs past their expiration date to expired status. */
export const processExpiredSessionPacks = mutation({
  handler: async (ctx) => {
    const now = Date.now();
    const expiredPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .filter((q) => 
        q.and(
          q.neq(q.field("expiresAt"), undefined),
          q.lt(q.field("expiresAt"), now)
        )
      )
      .collect();
    
    for (const pack of expiredPacks) {
      await ctx.db.patch(pack._id, { status: "expired" });
    }
    
    return expiredPacks;
  },
});

/** Soft-deletes a session pack by setting its deletedAt timestamp. */
export const deleteSessionPack = mutation({
  args: { id: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Adds sessions to a session pack. */
export const addSessionsToPack = mutation({
  args: {
    id: v.id("sessionPacks"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.id);
    if (!pack) {
      throw new Error("Session pack not found");
    }
    
    await ctx.db.patch(args.id, {
      totalSessions: pack.totalSessions + args.amount,
      remainingSessions: pack.remainingSessions + args.amount,
    });
    
    return await ctx.db.get(args.id);
  },
});

/** Removes sessions from a session pack. */
export const removeSessionsFromPack = mutation({
  args: {
    id: v.id("sessionPacks"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.id);
    if (!pack) {
      throw new Error("Session pack not found");
    }

    const newRemaining = pack.remainingSessions - args.amount;
    if (newRemaining < 0) {
      throw new Error("Cannot remove more sessions than remaining");
    }

    await ctx.db.patch(args.id, {
      remainingSessions: newRemaining,
      status: newRemaining === 0 ? "depleted" : pack.status,
    });

    return await ctx.db.get(args.id);
  },
});

/** Atomically sets the remaining sessions for a session pack. */
export const setRemainingSessions = mutation({
  args: {
    id: v.id("sessionPacks"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.id);
    if (!pack) {
      return null;
    }

    const newRemaining = Math.max(0, Math.min(args.amount, pack.totalSessions));
    await ctx.db.patch(args.id, {
      remainingSessions: newRemaining,
      status: newRemaining === 0 ? "depleted" : newRemaining === pack.totalSessions ? "active" : pack.status,
    });

    return await ctx.db.get(args.id);
  },
});

export const migrateSessionPack = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    instructorId: v.id("instructors"),
    totalSessions: v.optional(v.number()),
    remainingSessions: v.optional(v.number()),
    purchasedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("depleted"), v.literal("expired"), v.literal("refunded"))),
    paymentId: v.id("payments"),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("paymentId"), args.paymentId))
      .first();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.totalSessions) updates.totalSessions = args.totalSessions;
      if (args.remainingSessions) updates.remainingSessions = args.remainingSessions;
      if (args.status) updates.status = args.status;
      if (args.expiresAt) updates.expiresAt = args.expiresAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }
      return { action: "updated", id: existing._id };
    }

    const insertResult = await ctx.db.insert("sessionPacks", {
      userId: args.userId,
      instructorId: args.instructorId,
      totalSessions: args.totalSessions ?? 4,
      remainingSessions: args.remainingSessions ?? 4,
      purchasedAt: args.purchasedAt ?? Date.now(),
      expiresAt: args.expiresAt ?? undefined,
      status: args.status ?? "active",
      paymentId: args.paymentId,
    });

    return { action: "inserted", id: insertResult };
  },
});

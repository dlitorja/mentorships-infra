import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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

/** Returns all session packs associated with a given instructor. */
export const getInstructorSessionPacks = query({
  args: { mentorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("sessionPacks")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
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

/** Creates a new session pack for a user and mentor. */
export const createSessionPack = mutation({
  args: {
    userId: v.string(),
    mentorId: v.id("instructors"),
    totalSessions: v.optional(v.number()),
    remainingSessions: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    paymentId: v.id("payments"),
  },
  handler: async (ctx, args) => {
    const totalSessions = args.totalSessions ?? 4;
    return await ctx.db.insert("sessionPacks", {
      userId: args.userId,
      mentorId: args.mentorId,
      totalSessions,
      remainingSessions: args.remainingSessions ?? totalSessions,
      purchasedAt: Date.now(),
      expiresAt: args.expiresAt,
      status: "active",
      paymentId: args.paymentId,
    });
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

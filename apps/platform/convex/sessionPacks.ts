import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get session packs for a user
export const listByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionPacks")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .collect();
  },
});

// Get active session packs for a user
export const listActiveByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionPacks")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("status"), "active")
        )
      )
      .collect();
  },
});

// Get session pack by ID
export const getById = query({
  args: { id: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get session packs by instructor
export const listByInstructor = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionPacks")
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();
  },
});

// Create session pack (also creates workspace)
export const create = mutation({
  args: {
    userId: v.string(),
    instructorId: v.id("instructors"),
    totalSessions: v.number(),
    remainingSessions: v.number(),
    purchasedAt: v.number(),
    expiresAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("depleted"),
      v.literal("expired"),
      v.literal("refunded")
    ),
    paymentId: v.id("payments"),
    mentorshipType: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: args.userId,
      instructorId: args.instructorId,
      totalSessions: args.totalSessions,
      remainingSessions: args.remainingSessions,
      purchasedAt: args.purchasedAt,
      expiresAt: args.expiresAt,
      status: args.status,
      paymentId: args.paymentId,
      mentorshipType: args.mentorshipType,
    });

    // Auto-create workspace linked to sessionPack
    await ctx.db.insert("workspaces", {
      sessionPackId,
      instructorId: args.instructorId,
      ownerId: args.userId,
      name: "Mentorship Workspace",
      isPublic: false,
      type: "mentorship",
      menteeImageCount: 0,
      mentorImageCount: 0,
    });

    return sessionPackId;
  },
});

// Update session pack
export const update = mutation({
  args: {
    id: v.id("sessionPacks"),
    remainingSessions: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("depleted"),
      v.literal("expired"),
      v.literal("refunded")
    )),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

// Use a session (decrement remaining)
export const useSession = mutation({
  args: { id: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.id);
    if (!pack) throw new Error("Session pack not found");
    if (pack.remainingSessions <= 0) throw new Error("No sessions remaining");

    const newRemaining = pack.remainingSessions - 1;
    const newStatus = newRemaining === 0 ? "depleted" : pack.status;

    await ctx.db.patch(args.id, {
      remainingSessions: newRemaining,
      status: newStatus,
    });

    return await ctx.db.get(args.id);
  },
});

// Get total remaining sessions for a user
export const getUserTotalRemainingSessions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const packs = await ctx.db
      .query("sessionPacks")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("status"), "active")
        )
      )
      .collect();

    return packs.reduce((sum, pack) => sum + pack.remainingSessions, 0);
  },
});

// Get workspace by session pack ID
export const getWorkspaceBySessionPack = query({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("sessionPackId"), args.sessionPackId))
      .first();
  },
});

// Process expired session packs
export const processExpired = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const packs = await ctx.db
      .query("sessionPacks")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    for (const pack of packs) {
      if (pack.expiresAt && pack.expiresAt < now) {
        await ctx.db.patch(pack._id, { status: "expired" });
      }
    }
    return { processed: packs.length };
  },
});
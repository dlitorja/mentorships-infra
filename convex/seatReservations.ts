import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const WORKSPACE_IMAGE_CAPS = {
  mentee: 75,
  mentor: 150,
} as const;

export const getSeatReservationById = query({
  args: { id: v.id("seatReservations") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

export const getSeatReservationBySessionPack = query({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", args.sessionPackId))
      .first();
  },
});

export const getUserSeatReservations = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getMentorSeatReservations = query({
  args: { mentorId: v.id("mentors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .collect();
  },
});

export const getMentorActiveSeats = query({
  args: { mentorId: v.id("mentors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_mentorId_status", (q) => 
        q.eq("mentorId", args.mentorId).eq("status", "active")
      )
      .collect();
  },
});

export const getUserMentorSeat = query({
  args: { userId: v.string(), mentorId: v.id("mentors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_userId_mentorId", (q) => 
        q.eq("userId", args.userId).eq("mentorId", args.mentorId)
      )
      .first();
  },
});

export const createSeatReservation = mutation({
  args: {
    mentorId: v.id("mentors"),
    userId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    seatExpiresAt: v.number(),
    gracePeriodEndsAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("grace"), v.literal("released"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seatReservations")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", args.sessionPackId))
      .first();
    
    if (existing) {
      throw new Error("Seat reservation already exists for this session pack");
    }

    const mentor = await ctx.db.get(args.mentorId);
    if (!mentor) {
      throw new Error("Mentor not found");
    }

    const seatId = await ctx.db.insert("seatReservations", {
      ...args,
      status: args.status ?? "active",
    });

    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Mentorship Workspace`,
      description: `Workspace for mentorship with ${mentor.userId}`,
      ownerId: args.userId,
      mentorId: args.mentorId,
      isPublic: false,
      seatReservationId: seatId,
      menteeImageCount: 0,
      mentorImageCount: 0,
    });

    return { seatId, workspaceId };
  },
});

export const updateSeatReservation = mutation({
  args: {
    id: v.id("seatReservations"),
    seatExpiresAt: v.optional(v.number()),
    gracePeriodEndsAt: v.optional(v.number()),
    finalWarningNotificationSentAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("grace"), v.literal("released"))),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

export const releaseSeat = mutation({
  args: { id: v.id("seatReservations") },
  handler: async (ctx, args) => {
    const seat = await ctx.db.get(args.id);
    if (!seat) {
      throw new Error("Seat reservation not found");
    }

    await ctx.db.patch(args.id, { status: "released" });

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_seatReservationId", (q) => q.eq("seatReservationId", args.id))
      .collect();

    for (const workspace of workspaces) {
      await ctx.db.patch(workspace._id, { endedAt: Date.now() });
    }

    return await ctx.db.get(args.id);
  },
});

export const extendSeat = mutation({
  args: { 
    id: v.id("seatReservations"), 
    days: v.number() 
  },
  handler: async (ctx, args) => {
    const seat = await ctx.db.get(args.id);
    if (!seat) {
      throw new Error("Seat reservation not found");
    }
    
    const newExpiration = seat.seatExpiresAt + (args.days * 24 * 60 * 60 * 1000);
    await ctx.db.patch(args.id, { 
      seatExpiresAt: newExpiration,
      status: "active",
    });
    
    return await ctx.db.get(args.id);
  },
});

export const deleteSeatReservation = mutation({
  args: { id: v.id("seatReservations") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const processExpiredSeats = mutation({
  args: { mentorId: v.id("mentors") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiredSeats = await ctx.db
      .query("seatReservations")
      .withIndex("by_mentorId_status", (q) => 
        q.eq("mentorId", args.mentorId).eq("status", "active")
      )
      .filter((q) => q.lt(q.field("seatExpiresAt"), now))
      .collect();
    
    for (const seat of expiredSeats) {
      if (seat.gracePeriodEndsAt && now >= seat.gracePeriodEndsAt) {
        await ctx.db.patch(seat._id, { status: "released" });
      } else if (!seat.gracePeriodEndsAt) {
        const gracePeriodEnd = now + (7 * 24 * 60 * 60 * 1000);
        await ctx.db.patch(seat._id, { 
          status: "grace",
          gracePeriodEndsAt: gracePeriodEnd,
        });
      }
    }
    
    const expiredGraceSeats = await ctx.db
      .query("seatReservations")
      .withIndex("by_mentorId_status", (q) => 
        q.eq("mentorId", args.mentorId).eq("status", "grace")
      )
      .filter((q) => q.lt(q.field("gracePeriodEndsAt"), now))
      .collect();
    
    for (const seat of expiredGraceSeats) {
      await ctx.db.patch(seat._id, { status: "released" });
    }
    
    return expiredSeats;
  },
});

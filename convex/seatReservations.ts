import { query, mutation } from "./_generated/server";
import { v } from "convex/values";



/** Returns a seat reservation by its ID, or null if unauthenticated. */
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

/** Returns the seat reservation matching a given session pack ID, or null if unauthenticated. */
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

/** Returns all seat reservations for a given user ID. */
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

/** Returns all seat reservations for a given instructor ID. */
export const getInstructorSeatReservations = query({
  args: { mentorId: v.id("instructors") },
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

/** Returns all active seat reservations for a given instructor ID. */
export const getInstructorActiveSeats = query({
  args: { mentorId: v.id("instructors") },
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

/** Returns the seat reservation for a specific user-instructor pair, or null if unauthenticated. */
export const getUserInstructorSeat = query({
  args: { userId: v.string(), mentorId: v.id("instructors") },
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

/** Creates a new seat reservation and associated workspace, returning both IDs. */
export const createSeatReservation = mutation({
  args: {
    mentorId: v.id("instructors"),
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

/** Updates the expiration, grace period, notification status, or status of an existing seat reservation. */
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

/** Releases a seat reservation and ends its associated workspaces by setting endedAt. */
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

/** Extends a seat reservation's expiration date by a number of days and reactivates it. */
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

/** Permanently deletes a seat reservation by ID. */
export const deleteSeatReservation = mutation({
  args: { id: v.id("seatReservations") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/** Transitions expired active seats to grace period, and releases seats whose grace period has ended, ending associated workspaces. */
export const processExpiredSeats = mutation({
  args: { mentorId: v.id("instructors") },
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
        // Set endedAt on associated workspace to start 18-month countdown
        const workspaces = await ctx.db
          .query("workspaces")
          .withIndex("by_seatReservationId", (q) => q.eq("seatReservationId", seat._id))
          .collect();
        for (const ws of workspaces) {
          await ctx.db.patch(ws._id, { endedAt: now });
        }
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
      // Set endedAt on associated workspace to start 18-month countdown
      const workspaces = await ctx.db
        .query("workspaces")
        .withIndex("by_seatReservationId", (q) => q.eq("seatReservationId", seat._id))
        .collect();
      for (const ws of workspaces) {
        await ctx.db.patch(ws._id, { endedAt: now });
      }
    }
    
    return expiredSeats;
  },
});

import { query, mutation, internalMutation, internalAction, internalQuery, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const SERVER_SHARED_SECRET = process.env.CONVEX_SERVER_SHARED_SECRET;



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
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns all active seat reservations for a given instructor ID with student details. */
export const getInstructorActiveSeats = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || instructor.userId !== user.subject) {
      return [];
    }

    const seats = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId_status", (q) =>
        q.eq("instructorId", args.instructorId).eq("status", "active")
      )
      .collect();

    return Promise.all(
      seats.map(async (seat) => {
        const student = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", seat.userId))
          .first();
        return {
          ...seat,
          studentEmail: student?.email ?? null,
          studentFirstName: student?.firstName ?? null,
          studentLastName: student?.lastName ?? null,
        };
      })
    );
  },
});

/** Returns active students for an instructor with session pack counts. */
export const getInstructorStudentsWithRemainingSessions = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || instructor.userId !== user.subject) {
      return [];
    }

    const seats = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId_status", (q) =>
        q.eq("instructorId", args.instructorId).eq("status", "active")
      )
      .collect();

    const sessionPacks = await Promise.all(
      seats.map((seat) => ctx.db.get(seat.sessionPackId))
    );
    const sessionPackById = new Map(
      sessionPacks.filter((pack) => pack !== null).map((pack) => [pack._id, pack])
    );

    const rows = await Promise.all(
      seats.map(async (seat) => {
        const student = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", seat.userId))
          .first();
        const sessionPack = sessionPackById.get(seat.sessionPackId);

        return {
          userId: seat.userId,
          seatId: seat._id,
          sessionPackId: seat.sessionPackId,
          studentEmail: student?.email ?? null,
          studentFirstName: student?.firstName ?? null,
          studentLastName: student?.lastName ?? null,
          totalSessions: sessionPack?.totalSessions ?? 0,
          remainingSessions: sessionPack?.remainingSessions ?? 0,
          seatExpiresAt: seat.seatExpiresAt,
          status: seat.status,
        };
      })
    );

    return rows.sort((a, b) => a.remainingSessions - b.remainingSessions);
  },
});

/** Returns the seat reservation for a specific user-instructor pair, or null if unauthenticated. */
export const getUserInstructorSeat = query({
  args: { userId: v.string(), instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_userId_instructorId", (q) =>
        q.eq("userId", args.userId).eq("instructorId", args.instructorId)
      )
      .first();
  },
});

/** Creates a new seat reservation and associated workspace, returning both IDs. */
export const createSeatReservation = mutation({
  args: {
    instructorId: v.id("instructors"),
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

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    const seatId = await ctx.db.insert("seatReservations", {
      ...args,
      status: args.status ?? "active",
    });

    const seatReservation = await ctx.db.get(seatId);

    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Mentorship Workspace`,
      description: `Workspace for mentorship with ${instructor.userId}`,
      ownerId: args.userId,
      instructorId: args.instructorId,
      isPublic: false,
      seatReservationId: seatId,
      studentImageCount: 0,
      instructorImageCount: 0,
    });

    return seatReservation;
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
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiredSeats = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId_status", (q) =>
        q.eq("instructorId", args.instructorId).eq("status", "active")
      )
      .filter((q) => q.lt(q.field("seatExpiresAt"), now))
      .collect();

    for (const seat of expiredSeats) {
      if (seat.gracePeriodEndsAt && now >= seat.gracePeriodEndsAt) {
        await ctx.db.patch(seat._id, { status: "released" });
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
      .withIndex("by_instructorId_status", (q) =>
        q.eq("instructorId", args.instructorId).eq("status", "grace")
      )
      .filter((q) => q.lt(q.field("gracePeriodEndsAt"), now))
      .collect();

    for (const seat of expiredGraceSeats) {
      await ctx.db.patch(seat._id, { status: "released" });
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

export const migrateSeatReservation = mutation({
  args: {
    id: v.string(),
    instructorId: v.id("instructors"),
    userId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    seatExpiresAt: v.number(),
    gracePeriodEndsAt: v.optional(v.number()),
    finalWarningNotificationSentAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("grace"), v.literal("released"))),
  },
  handler: async (ctx, args) => {
    const existingByPack = await ctx.db
      .query("seatReservations")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", args.sessionPackId))
      .first();

    if (existingByPack) {
      const updates: Record<string, unknown> = {};
      if (args.status) updates.status = args.status;
      if (args.seatExpiresAt) updates.seatExpiresAt = args.seatExpiresAt;
      if (args.gracePeriodEndsAt) updates.gracePeriodEndsAt = args.gracePeriodEndsAt;
      if (args.finalWarningNotificationSentAt) updates.finalWarningNotificationSentAt = args.finalWarningNotificationSentAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByPack._id, updates);
      }
      return { action: "updated", id: existingByPack._id };
    }

    const insertResult = await ctx.db.insert("seatReservations", {
      instructorId: args.instructorId,
      userId: args.userId,
      sessionPackId: args.sessionPackId,
      seatExpiresAt: args.seatExpiresAt,
      gracePeriodEndsAt: args.gracePeriodEndsAt ?? undefined,
      finalWarningNotificationSentAt: args.finalWarningNotificationSentAt ?? undefined,
      status: args.status ?? "active",
    });

    return { action: "inserted", id: insertResult };
  },
});

export const updateFinalWarningSent = internalMutation({
  args: {
    seatId: v.id("seatReservations"),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.seatId, {
      finalWarningNotificationSentAt: args.sentAt,
    });
    return { success: true };
  },
});

export const getSeatBySessionPackId = internalQuery({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("seatReservations")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", args.sessionPackId))
      .first();
  },
});

export const releaseSeatById = internalMutation({
  args: { seatId: v.id("seatReservations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.seatId, { status: "released" });
    return { success: true };
  },
});

export const listSeatsNeedingWarning = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const warningThreshold = now + 12 * 60 * 60 * 1000;

    const seats = await ctx.db
      .query("seatReservations")
      .withIndex("by_status", (q) => q.eq("status", "grace"))
      .filter((q) =>
        q.and(
          q.lte(q.field("gracePeriodEndsAt"), warningThreshold),
          q.gt(q.field("gracePeriodEndsAt"), now),
          q.eq(q.field("finalWarningNotificationSentAt"), undefined)
        )
      )
      .collect();

    return seats.map((seat) => ({
      seatId: seat._id,
      sessionPackId: seat.sessionPackId,
      gracePeriodEndsAt: seat.gracePeriodEndsAt,
      userId: seat.userId,
    }));
  },
});

export const sendGracePeriodFinalWarning = internalAction({
  args: {},
  handler: async (ctx) => {
    const seats = await ctx.runQuery(internal.seatReservations.listSeatsNeedingWarning, {});

    let sentCount = 0;
    let failedCount = 0;
    for (const seat of seats) {
      try {
        const result = await ctx.runAction(internal.notifications.handleNotificationSend, {
          payload: {
            type: "grace_period_final_warning",
            userId: seat.userId,
            sessionPackId: seat.sessionPackId,
            message: "Your seat will be released in 12 hours. Renew now to keep your mentorship active.",
            gracePeriodEndsAt: seat.gracePeriodEndsAt ?? undefined,
          },
        });

        if (result.success) {
          try {
            await ctx.runMutation(internal.seatReservations.updateFinalWarningSent, {
              seatId: seat.seatId,
              sentAt: Date.now(),
            });
            sentCount++;
          } catch (mutationErr) {
            console.error(`Failed to mark warning sent for seat ${seat.seatId}:`, mutationErr);
            failedCount++;
          }
        } else {
          console.warn(`Notification send returned success=false for seat ${seat.seatId}:`, result);
          failedCount++;
        }
      } catch (actionErr) {
        console.error(`Failed to send notification for seat ${seat.seatId}:`, actionErr);
        failedCount++;
      }
    }

    return { success: true, warningsSent: sentCount, failedCount };
  },
});

export const linkSeatReservationsByEmail = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase().trim();
    const placeholderUserId = `email:${normalizedEmail}`;

    const seatsToLink = await ctx.db
      .query("seatReservations")
      .withIndex("by_userId", (q) => q.eq("userId", placeholderUserId))
      .collect();

    for (const seat of seatsToLink) {
      await ctx.db.patch(seat._id, { userId: args.clerkUserId });
    }

    return { linked: seatsToLink.length };
  },
});

export const linkSeatReservationsByEmailAction = action({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args): Promise<{ linked: number }> => {
    if (args.secret !== SERVER_SHARED_SECRET) {
      throw new Error("Unauthorized: Invalid secret");
    }

    if (!args.clerkUserId || typeof args.clerkUserId !== "string" || !args.clerkUserId.trim()) {
      throw new Error("Missing or empty clerkUserId");
    }
    if (!args.email || typeof args.email !== "string" || !args.email.trim()) {
      throw new Error("Missing or empty email");
    }

    const result = await ctx.runMutation(internal.seatReservations.linkSeatReservationsByEmail, {
      clerkUserId: args.clerkUserId.trim(),
      email: args.email.trim().toLowerCase(),
    });

    return result;
  },
});

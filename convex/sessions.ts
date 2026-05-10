import { query, mutation, internalAction, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";

/** Returns a session by its ID. */
export const getSessionById = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

/** Returns all sessions for a given student. */
export const getStudentSessions = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("sessions")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .collect();
  },
});

/** Returns all sessions for a given instructor. */
export const getInstructorSessions = query({
  args: { mentorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("sessions")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .collect();
  },
});

/** Returns upcoming scheduled sessions for a student. */
export const getUpcomingSessions = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const now = Date.now();
    return await ctx.db
      .query("sessions")
      .withIndex("by_studentId_status_scheduledAt", (q) => 
        q.eq("studentId", args.studentId)
          .eq("status", "scheduled")
      )
      .filter((q) => q.gt(q.field("scheduledAt"), now))
      .collect();
  },
});

/** Returns a session matching a Google Calendar event ID. */
export const getSessionByCalendarEventId = query({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("sessions")
      .withIndex("by_googleCalendarEventId", (q) => q.eq("googleCalendarEventId", args.eventId))
      .first();
  },
});

/** Creates a new session with scheduled status. */
export const createSession = mutation({
  args: {
    mentorId: v.id("instructors"),
    studentId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    scheduledAt: v.number(),
    recordingConsent: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sessions", {
      ...args,
      status: "scheduled",
      recordingConsent: args.recordingConsent ?? false,
    });
  },
});

/** Updates specified fields on an existing session. */
export const updateSession = mutation({
  args: {
    id: v.id("sessions"),
    scheduledAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("scheduled"), v.literal("completed"), v.literal("canceled"), v.literal("no_show"))),
    recordingConsent: v.optional(v.boolean()),
    recordingUrl: v.optional(v.string()),
    recordingExpiresAt: v.optional(v.number()),
    googleCalendarEventId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Marks a session as completed with a timestamp and optional recording/notes. */
export const completeSession = mutation({
  args: { 
    id: v.id("sessions"),
    recordingUrl: v.optional(v.string()),
    recordingExpiresAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, {
      status: "completed",
      completedAt: Date.now(),
      ...updates,
    });
    return await ctx.db.get(id);
  },
});

/** Cancels a session by setting its status to canceled. */
export const cancelSession = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "canceled",
      canceledAt: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

/** Soft-deletes a session by setting its deletedAt timestamp. */
export const deleteSession = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const migrateSession = mutation({
  args: {
    id: v.string(),
    mentorId: v.id("instructors"),
    studentId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    scheduledAt: v.number(),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("scheduled"), v.literal("completed"), v.literal("canceled"), v.literal("no_show"))),
    recordingConsent: v.optional(v.boolean()),
    recordingUrl: v.optional(v.string()),
    recordingExpiresAt: v.optional(v.number()),
    googleCalendarEventId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingByCalendarEvent = args.googleCalendarEventId
      ? await ctx.db
          .query("sessions")
          .withIndex("by_googleCalendarEventId", (q) => q.eq("googleCalendarEventId", args.googleCalendarEventId!))
          .first()
      : null;

    if (existingByCalendarEvent) {
      const updates: Record<string, unknown> = {};
      if (args.status) updates.status = args.status;
      if (args.completedAt) updates.completedAt = args.completedAt;
      if (args.canceledAt) updates.canceledAt = args.canceledAt;
      if (args.notes) updates.notes = args.notes;
      if (args.recordingUrl) updates.recordingUrl = args.recordingUrl;
      if (args.recordingConsent !== undefined) updates.recordingConsent = args.recordingConsent;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByCalendarEvent._id, updates);
      }
      return { action: "updated", id: existingByCalendarEvent._id };
    }

    const insertResult = await ctx.db.insert("sessions", {
      mentorId: args.mentorId,
      studentId: args.studentId,
      sessionPackId: args.sessionPackId,
      scheduledAt: args.scheduledAt,
      completedAt: args.completedAt ?? undefined,
      canceledAt: args.canceledAt ?? undefined,
      status: args.status ?? "scheduled",
      recordingConsent: args.recordingConsent ?? false,
      recordingUrl: args.recordingUrl ?? undefined,
      recordingExpiresAt: args.recordingExpiresAt ?? undefined,
      googleCalendarEventId: args.googleCalendarEventId ?? undefined,
      notes: args.notes ?? undefined,
    });

    return { action: "inserted", id: insertResult };
  },
});

export const handleRenewalReminder = internalAction({
  args: {
    sessionPackId: v.string(),
    userId: v.string(),
    sessionNumber: v.number(),
    remainingSessions: v.number(),
    gracePeriodEndsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { sessionPackId, userId, sessionNumber, remainingSessions, gracePeriodEndsAt } = args;

    if (sessionNumber === 3) {
      await ctx.runAction(internal.notifications.handleNotificationSend, {
        payload: {
          type: "renewal_reminder",
          userId,
          sessionPackId,
          message: "You have 1 session remaining. Renew now to continue your mentorship.",
          sessionNumber: 3,
        },
      });
    } else if (sessionNumber === 4) {
      const graceDate = gracePeriodEndsAt
        ? new Date(gracePeriodEndsAt).toLocaleString("en-US", { timeZone: "UTC" })
        : "in 7 days";

      await ctx.runAction(internal.notifications.handleNotificationSend, {
        payload: {
          type: "final_renewal_reminder",
          userId,
          sessionPackId,
          message: `Your pack is complete. Renew within 7 days to keep your seat. Grace period ends: ${graceDate}`,
          sessionNumber: 4,
          gracePeriodEndsAt,
        },
      });
    }

    return {
      success: true,
      sessionPackId,
      userId,
      sessionNumber,
    };
  },
});

export const getSessionByIdInternal = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    try {
      return await ctx.db.get(args.sessionId as Id<"sessions">);
    } catch {
      return null;
    }
  },
});

export const getSessionPackByIdInternal = internalQuery({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionPackId);
  },
});

export const getCompletedSessionCountInternal = internalQuery({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", args.sessionPackId))
      .collect();
    return sessions.filter(s => s.status === "completed").length;
  },
});

export const decrementRemainingSessions = internalMutation({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.sessionPackId);
    if (!pack) {
      return null;
    }

    const newRemaining = Math.max(0, pack.remainingSessions - 1);
    const newStatus = newRemaining === 0 ? "depleted" : pack.status;

    await ctx.db.patch(args.sessionPackId, {
      remainingSessions: newRemaining,
      status: newStatus,
    });

    return await ctx.db.get(args.sessionPackId);
  },
});

export const updateSeatReservationStatusInternal = internalMutation({
  args: {
    sessionPackId: v.id("sessionPacks"),
    status: v.union(v.literal("active"), v.literal("grace"), v.literal("released")),
    gracePeriodEndsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const seat = await ctx.db
      .query("seatReservations")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", args.sessionPackId))
      .first();

    if (!seat) {
      return null;
    }

    const updates: Record<string, unknown> = { status: args.status };
    if (args.gracePeriodEndsAt !== undefined) {
      updates.gracePeriodEndsAt = args.gracePeriodEndsAt;
    }

    await ctx.db.patch(seat._id, updates);
    return await ctx.db.get(seat._id);
  },
});

export const updateSessionPackStatusInternal = internalMutation({
  args: {
    sessionPackId: v.id("sessionPacks"),
    status: v.union(v.literal("active"), v.literal("depleted"), v.literal("expired"), v.literal("refunded")),
    remainingSessions: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = { status: args.status };
    if (args.remainingSessions !== undefined) {
      updates.remainingSessions = args.remainingSessions;
    }

    await ctx.db.patch(args.sessionPackId, updates);
    return await ctx.db.get(args.sessionPackId);
  },
});

export const listExpiredPacks = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const packs = await ctx.db
      .query("sessionPacks")
      .withIndex("by_status", (q) => q.eq("status", "depleted"))
      .collect();

    const expiredPacks = packs.filter(p =>
      p.expiresAt && p.expiresAt <= now
    );

    const expiredWithDepletedStatus = await ctx.db
      .query("sessionPacks")
      .withIndex("by_status", (q) => q.eq("status", "expired"))
      .collect();

    return [...expiredPacks, ...expiredWithDepletedStatus].map(pack => ({
      packId: pack._id,
      userId: pack.userId,
      mentorId: pack.mentorId,
      status: pack.status,
      expiresAt: pack.expiresAt,
    }));
  },
});

export const listExpiredGraceSeats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const seats = await ctx.db
      .query("seatReservations")
      .withIndex("by_status", (q) => q.eq("status", "grace"))
      .collect();

    return seats
      .filter(seat => seat.gracePeriodEndsAt && seat.gracePeriodEndsAt <= now)
      .map(seat => ({
        seatId: seat._id,
        sessionPackId: seat.sessionPackId,
        userId: seat.userId,
        mentorId: seat.mentorId,
        gracePeriodEndsAt: seat.gracePeriodEndsAt,
      }));
  },
});

export const checkScheduledSessionsForPack = internalQuery({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", args.sessionPackId))
      .collect();

    const hasScheduled = sessions.some(s => s.status === "scheduled");
    return { hasScheduledSessions: hasScheduled };
  },
});

export const handleSessionCompleted = internalAction({
  args: {
    sessionId: v.string(),
    sessionPackId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const { sessionId, sessionPackId, userId } = args;

    const sessionDoc: Doc<"sessions"> | null = await ctx.runQuery(internal.sessions.getSessionByIdInternal, {
      sessionId,
      sessionPackId,
    });

    if (!sessionDoc) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (sessionDoc.status !== "completed") {
      throw new Error(`Session ${sessionId} is not completed`);
    }

    const pack: Doc<"sessionPacks"> | null = await ctx.runQuery(internal.sessions.getSessionPackByIdInternal, {
      sessionPackId: sessionPackId as Id<"sessionPacks">,
    });

    if (!pack) {
      throw new Error(`Session pack ${sessionPackId} not found`);
    }

    const updatedPack: Doc<"sessionPacks"> | null = await ctx.runMutation(internal.sessions.decrementRemainingSessions, {
      sessionPackId: pack._id,
    });

    const completedCount: number = await ctx.runQuery(internal.sessions.getCompletedSessionCountInternal, {
      sessionPackId: pack._id,
    });

    if (updatedPack && updatedPack.remainingSessions === 0) {
      const gracePeriodEndsAt = Date.now() + (7 * 24 * 60 * 60 * 1000);

      await ctx.runMutation(internal.sessions.updateSeatReservationStatusInternal, {
        sessionPackId: pack._id,
        status: "grace",
        gracePeriodEndsAt,
      });

      await ctx.runMutation(internal.sessions.updateSessionPackStatusInternal, {
        sessionPackId: pack._id,
        status: "depleted",
        remainingSessions: 0,
      });
    }

    if (completedCount === 3) {
      await ctx.runAction(internal.sessions.handleRenewalReminder, {
        sessionPackId,
        userId,
        sessionNumber: 3,
        remainingSessions: updatedPack?.remainingSessions ?? 0,
      });
    } else if (completedCount === 4) {
      const gracePeriodEndsAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
      await ctx.runAction(internal.sessions.handleRenewalReminder, {
        sessionPackId,
        userId,
        sessionNumber: 4,
        remainingSessions: 0,
        gracePeriodEndsAt,
      });
    }

    return {
      success: true,
      sessionId,
      sessionPackId,
      remainingSessions: updatedPack?.remainingSessions ?? 0,
      completedCount,
    };
  },
});

export const checkSeatExpiration = internalAction({
  args: {},
  handler: async (ctx) => {
    type ExpiredPack = {
      packId: Id<"sessionPacks">;
      userId: string;
      mentorId: string | null;
      status: string;
      expiresAt: number | undefined;
    };
    type ExpiredGraceSeat = {
      seatId: Id<"seatReservations">;
      sessionPackId: Id<"sessionPacks">;
      userId: string;
      mentorId: string | null;
      gracePeriodEndsAt: number | undefined;
    };
    const expiredPacks: ExpiredPack[] = await ctx.runQuery(internal.sessions.listExpiredPacks, {});

    let releasedCount = 0;
    for (const pack of expiredPacks) {
      const { hasScheduledSessions } = await ctx.runQuery(
        internal.sessions.checkScheduledSessionsForPack,
        { sessionPackId: pack.packId }
      );

      if (!hasScheduledSessions) {
        const seat = await ctx.runQuery(
          internal.seatReservations.getSeatBySessionPackId,
          { sessionPackId: pack.packId }
        );

        if (seat) {
          await ctx.runMutation(internal.seatReservations.releaseSeatById, {
            seatId: seat._id,
          });
          releasedCount++;
        }
      }
    }

    const expiredGraceSeats: ExpiredGraceSeat[] = await ctx.runQuery(internal.sessions.listExpiredGraceSeats, {});

    for (const seat of expiredGraceSeats) {
      await ctx.runMutation(internal.seatReservations.releaseSeatById, {
        seatId: seat.seatId,
      });
    }

    return {
      success: true,
      expiredPacksChecked: expiredPacks.length,
      expiredGraceSeatsReleased: expiredGraceSeats.length,
      seatsReleasedFromExpiredPacks: releasedCount,
    };
  },
});

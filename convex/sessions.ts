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
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      return [];
    }

    if (instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: cannot access another instructor's sessions");
    }

    return await ctx.db
      .query("sessions")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns upcoming scheduled sessions for an instructor with student info. */
export const getInstructorUpcomingSessions = query({
  args: {
    instructorId: v.id("instructors"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      return [];
    }

    if (instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: cannot access another instructor's sessions");
    }

    const limit = args.limit ?? 10;
    const now = Date.now();

    const allSessions = await ctx.db
      .query("sessions")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "scheduled"),
          q.gt(q.field("scheduledAt"), now)
        )
      )
      .collect();

    const upcoming = allSessions
      .sort((a, b) => a.scheduledAt - b.scheduledAt)
      .slice(0, limit);

    const sessionsWithData = await Promise.all(
      upcoming.map(async (session) => {
        const studentUser = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", session.studentId))
          .first();

        const sessionPack = await ctx.db.get(session.sessionPackId);

        return {
          id: session._id,
          scheduledAt: session.scheduledAt,
          status: session.status,
          studentEmail: studentUser?.email ?? null,
          remainingSessions: sessionPack?.remainingSessions ?? null,
        };
      })
    );

    return sessionsWithData;
  },
});

/** Returns past sessions (completed/canceled/no_show) for an instructor within a time window. */
export const getInstructorPastSessions = query({
  args: {
    instructorId: v.id("instructors"),
    limit: v.optional(v.number()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      return [];
    }

    if (instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: cannot access another instructor's sessions");
    }

    const limit = args.limit ?? 10;
    const days = args.days ?? 30;
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_instructorId_status_scheduledAt", (q) =>
        q.eq("instructorId", args.instructorId)
      )
      .collect();

    const pastSessions = sessions
      .filter((session) =>
        (session.status === "completed" ||
          session.status === "canceled" ||
          session.status === "no_show") &&
        session.scheduledAt >= cutoff
      )
      .sort((a, b) => {
        const aTime = a.completedAt || a.canceledAt || a.scheduledAt;
        const bTime = b.completedAt || b.canceledAt || b.scheduledAt;
        return bTime - aTime;
      })
      .slice(0, limit);

    const sessionsWithData = await Promise.all(
      pastSessions.map(async (session) => {
        const studentUser = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", session.studentId))
          .first();

        return {
          id: session._id,
          scheduledAt: session.scheduledAt,
          completedAt: session.completedAt,
          canceledAt: session.canceledAt,
          status: session.status,
          studentEmail: studentUser?.email ?? null,
          notes: session.notes ?? null,
        };
      })
    );

    return sessionsWithData;
  },
});

export type InstructorAllSession = {
  id: Id<"sessions">;
  scheduledAt: number;
  status: "scheduled" | "completed" | "canceled" | "no_show";
  notes: string | null;
  recordingUrl: string | null;
  completedAt: number | null;
  canceledAt: number | null;
  studentEmail: string | null;
  remainingSessions: number | null;
  sessionPackId: Id<"sessionPacks">;
};

/** Returns all sessions for an instructor with student info and session pack data. */
export const getInstructorAllSessions = query({
  args: {
    instructorId: v.id("instructors"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      return [];
    }

    if (instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: cannot access another instructor's sessions");
    }

    const limit = args.limit ?? 100;

    const allSessions = await ctx.db
      .query("sessions")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();

    const sortedSessions = allSessions
      .sort((a, b) => b.scheduledAt - a.scheduledAt)
      .slice(0, limit);

    const sessionsWithData = await Promise.all(
      sortedSessions.map(async (session) => {
        const studentUser = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", session.studentId))
          .first();

        const sessionPack = await ctx.db.get(session.sessionPackId);

        return {
          id: session._id,
          scheduledAt: session.scheduledAt,
          status: session.status,
          notes: session.notes ?? null,
          recordingUrl: session.recordingUrl ?? null,
          completedAt: session.completedAt ?? null,
          canceledAt: session.canceledAt ?? null,
          studentEmail: studentUser?.email ?? null,
          remainingSessions: sessionPack?.remainingSessions ?? null,
          sessionPackId: session.sessionPackId,
        } as InstructorAllSession;
      })
    );

    return sessionsWithData;
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

/** Returns upcoming scheduled sessions for a student with instructor information. Used by student dashboard. */
export const getUpcomingSessionsWithInstructor = query({
  args: {
    studentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const limit = args.limit ?? 5;
    const now = Date.now();

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_studentId_status_scheduledAt", (q) =>
        q.eq("studentId", args.studentId)
          .eq("status", "scheduled")
      )
      .filter((q) => q.gt(q.field("scheduledAt"), now))
      .collect();

    const sortedSessions = sessions.sort((a, b) => a.scheduledAt - b.scheduledAt);
    const limitedSessions = sortedSessions.slice(0, limit);

    const sessionsWithInstructor = await Promise.all(
      limitedSessions.map(async (session) => {
        const instructor = await ctx.db.get(session.instructorId);
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
          id: session._id,
          scheduledAt: session.scheduledAt,
          status: session.status,
          instructorId: session.instructorId,
          instructorUser: instructorUser ? {
            email: instructorUser.email,
          } : null,
        };
      })
    );

    return sessionsWithInstructor;
  },
});

/** Returns recent completed/canceled sessions for a student with instructor information. Used by student dashboard. */
export const getRecentSessionsWithInstructor = query({
  args: {
    studentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const limit = args.limit ?? 3;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "completed"),
          q.eq(q.field("status"), "canceled"),
          q.eq(q.field("status"), "no_show")
        )
      )
      .collect();

    const sortedSessions = sessions.sort((a, b) => {
      const aTime = a.completedAt || a.canceledAt || a._creationTime;
      const bTime = b.completedAt || b.canceledAt || b._creationTime;
      return bTime - aTime;
    });
    const limitedSessions = sortedSessions.slice(0, limit);

    const sessionsWithInstructor = await Promise.all(
      limitedSessions.map(async (session) => {
        const instructor = await ctx.db.get(session.instructorId);
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
          id: session._id,
          scheduledAt: session.scheduledAt,
          completedAt: session.completedAt,
          canceledAt: session.canceledAt,
          status: session.status,
          instructorId: session.instructorId,
          instructorUser: instructorUser ? {
            email: instructorUser.email,
          } : null,
        };
      })
    );

    return sessionsWithInstructor;
  },
});

/** Returns all sessions for a student with instructor info and remaining sessions. Used by sessions page. */
export const getAllStudentSessionsWithInstructor = query({
  args: {
    studentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    if (identity.tokenIdentifier !== args.studentId) {
      throw new Error("Forbidden: cannot access another user's sessions");
    }

    const limit = args.limit ?? 50;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .collect();

    const sortedSessions = sessions.sort((a, b) => b.scheduledAt - a.scheduledAt);
    const limitedSessions = sortedSessions.slice(0, limit);

    const sessionsWithData = await Promise.all(
      limitedSessions.map(async (session) => {
        const instructor = await ctx.db.get(session.instructorId);
        let instructorEmail: string | null = null;
        const instructorUserId = instructor?.userId;
        if (instructorUserId) {
          const users = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", instructorUserId))
            .first();
          instructorEmail = users?.email ?? null;
        }

        const sessionPack = await ctx.db.get(session.sessionPackId);

        return {
          id: session._id,
          scheduledAt: session.scheduledAt,
          completedAt: session.completedAt,
          canceledAt: session.canceledAt,
          status: session.status,
          recordingUrl: session.recordingUrl ?? null,
          notes: session.notes ?? null,
          instructorEmail,
          packId: session.sessionPackId,
          remainingSessions: sessionPack?.remainingSessions ?? null,
        };
      })
    );

    return sessionsWithData;
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
    instructorId: v.id("instructors"),
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
  args: { 
    id: v.id("sessions"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== "scheduled") {
      throw new Error("Only scheduled sessions can be canceled");
    }

    const instructor = await ctx.db.get(session.instructorId);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    if (!instructor || instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: cannot cancel another instructor's session");
    }

    const updates: Record<string, unknown> = {
      status: "canceled",
      canceledAt: Date.now(),
    };
    if (args.reason) {
      updates.cancelReason = args.reason;
    }

    await ctx.db.patch(args.id, updates);

    return await ctx.db.get(args.id);
  },
});

/** Reschedules a session to a new time. Instructors can reschedule at any time. */
export const rescheduleSession = mutation({
  args: {
    id: v.id("sessions"),
    newScheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== "scheduled") {
      throw new Error("Only scheduled sessions can be rescheduled");
    }

    const instructor = await ctx.db.get(session.instructorId);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    if (!instructor || instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: cannot reschedule another instructor's session");
    }

    await ctx.db.patch(args.id, {
      scheduledAt: args.newScheduledAt,
    });

    return await ctx.db.get(args.id);
  },
});

/** Updates session notes. */
export const updateSessionNotes = mutation({
  args: {
    id: v.id("sessions"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) {
      throw new Error("Session not found");
    }
    
    const instructor = await ctx.db.get(session.instructorId);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    if (!instructor || instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: cannot update another instructor's session");
    }

    await ctx.db.patch(args.id, {
      notes: args.notes,
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
    instructorId: v.id("instructors"),
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
      instructorId: args.instructorId,
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
      instructorId: pack.instructorId,
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
        instructorId: seat.instructorId,
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
  handler: async (ctx, args): Promise<{
    success: boolean;
    sessionId: string;
    sessionPackId: string;
    remainingSessions: number;
    completedCount: number;
  }> => {
    const { sessionId, sessionPackId, userId } = args;

    const sessionDoc: Doc<"sessions"> | null = await ctx.runQuery(internal.sessions.getSessionByIdInternal, {
      sessionId,
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
      instructorId: string | null;
      status: string;
      expiresAt: number | undefined;
    };
    type ExpiredGraceSeat = {
      seatId: Id<"seatReservations">;
      sessionPackId: Id<"sessionPacks">;
      userId: string;
      instructorId: string | null;
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
          try {
            await ctx.runMutation(internal.seatReservations.releaseSeatById, {
              seatId: seat._id,
            });
            await ctx.runMutation(internal.sessions.updateSessionPackStatusInternal, {
              sessionPackId: pack.packId,
              status: "refunded",
            });
            releasedCount++;
          } catch (error) {
            console.error(`Failed to process expired pack ${pack.packId}:`, error);
          }
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

/**
 * Attaches Daily.co recording metadata to the session matched by room name.
 * Invoked by `attachRecordingFromDailyWebhookAction` (defined in
 * convex/dailyRecordingActions.ts) after HMAC verification inside the
 * Convex action layer.
 *
 * Idempotent: if a recording has already been attached for the matched
 * session, the existing fields are preserved. Daily occasionally re-fires
 * the recording-ready event for the same room (retry, redelivery); without
 * this guard the first recorded call would be silently overwritten by a
 * later delivery, surfacing the wrong playback item in PR #4's Notes tab.
 *
 * Also defends against duplicate room names: if more than one session
 * shares the same `videoRoomName` (data drift), this throws so the caller
 * can investigate rather than silently attaching to the wrong row.
 *
 * Stored as `internalMutation` so the public action layer controls access;
 * the internal mutation is not callable from the Next.js route layer
 * directly. PR #2 will set `callEndedAt` at the actual call-end moment
 * via POST /api/video/end/[sessionId]; this mutation only sets it if
 * the end endpoint hasn't already written it, so the Daily processing
 * delay (1–5 min after hangup) doesn't inflate call-duration metrics.
 */
export const attachRecordingFromDailyWebhook = internalMutation({
  args: {
    roomName: v.string(),
    recordingS3Key: v.string(),
    durationSeconds: v.optional(v.number()),
    recordingId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sessionId: Id<"sessions">; alreadyAttached: boolean }> => {
    const matches = await ctx.db
      .query("sessions")
      .withIndex("by_videoRoomName", (q) =>
        q.eq("videoRoomName", args.roomName)
      )
      .collect();
    if (matches.length === 0) {
      throw new Error(`No session found for videoRoomName: ${args.roomName}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple sessions (${matches.length}) share videoRoomName: ${args.roomName}. ` +
          `Room names must be unique — investigate duplicates before re-running.`
      );
    }
    const session = matches[0];

    // Idempotency: if a recording is already attached, keep the original.
    if (session.recordingUrl !== undefined) {
      return { sessionId: session._id, alreadyAttached: true };
    }

    const patch: Partial<Doc<"sessions">> = {
      recordingUrl: args.recordingS3Key,
    };
    if (session.callEndedAt === undefined) {
      patch.callEndedAt = Date.now();
    }
    if (args.durationSeconds !== undefined) {
      patch.recordingDurationSeconds = args.durationSeconds;
    }
    if (args.recordingId !== undefined) {
      patch.recordingId = args.recordingId;
    }
    await ctx.db.patch(session._id, patch);
    return { sessionId: session._id, alreadyAttached: false };
  },
});

/**
 * Attaches Daily room metadata (name + URL) to a session.
 *
 * Idempotent at the caller level: if the session already has a
 * `videoRoomName`, the route layer returns the existing value without
 * calling Daily. This mutation always patches, so callers MUST check
 * `session.videoRoomName !== undefined` first.
 *
 * Auth: instructor on the session only. Students cannot create rooms
 * — this prevents burning Daily quota or creating orphan rooms.
 */
export const setVideoRoom = mutation({
  args: {
    sessionId: v.id("sessions"),
    videoRoomName: v.string(),
    videoRoomUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const instructor = await ctx.db.get(session.instructorId);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    if (!instructor || instructor.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden: only the session's instructor can create a room");
    }

    if (session.videoRoomName !== undefined) {
      return session;
    }

    await ctx.db.patch(args.sessionId, {
      videoRoomName: args.videoRoomName,
      videoRoomUrl: args.videoRoomUrl,
    });

    return await ctx.db.get(args.sessionId);
  },
});

/**
 * Marks a video call as ended by setting `callEndedAt`. Either party
 * on the session (instructor OR student) may end the call — both
 * parties need an "End" button on the UI.
 *
 * Idempotent: if `callEndedAt` is already set, the existing value is
 * returned without writing. This means retried/replayed POSTs are safe.
 *
 * Does NOT delete the Daily room — leaving the room up lets the
 * recording webhook (PR #1) fire and attach recording metadata. The
 * room auto-expires 24h after creation via Daily's `eject_at_room_exp`.
 */
export const endCall = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args): Promise<number> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const instructor = await ctx.db.get(session.instructorId);
    const isInstructor =
      instructor !== null && instructor.userId === identity.tokenIdentifier;
    const isStudent = identity.tokenIdentifier === session.studentId;

    if (!isInstructor && !isStudent) {
      throw new Error("Forbidden: only session participants can end the call");
    }

    if (session.callEndedAt !== undefined) {
      return session.callEndedAt;
    }

    const callEndedAt = Date.now();
    await ctx.db.patch(args.sessionId, { callEndedAt });
    return callEndedAt;
  },
});

export type VideoCallRole = "owner" | "participant";

export type SessionRoleForVideo = {
  sessionId: Id<"sessions">;
  role: VideoCallRole;
};

/**
 * Resolves a Daily room name to a session and the caller's role
 * (`owner` for the instructor, `participant` for the student on the
 * session's workspace).
 *
 * Role is derived server-side from the authenticated Clerk identity
 * vs. `sessions.instructorId` / the workspace whose `ownerId` matches
 * the caller. NEVER trust a role hint from the URL or request body.
 *
 * Refuses once `callEndedAt` is set — the token endpoint uses this
 * as its sole "call is over" gate (Daily's `eject_after_elapsed` is
 * the second, slower gate). Symmetric for instructor and student:
 * neither can rejoin via a fresh JWT after End Call.
 *
 * Used by `GET /api/video/token/[roomName]` to determine whether the
 * caller should receive an owner-role or participant-role meeting JWT.
 */
export const getSessionByVideoRoomName = query({
  args: { videoRoomName: v.string() },
  handler: async (ctx, args): Promise<SessionRoleForVideo | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const matches = await ctx.db
      .query("sessions")
      .withIndex("by_videoRoomName", (q) =>
        q.eq("videoRoomName", args.videoRoomName)
      )
      .collect();

    if (matches.length === 0) {
      return null;
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple sessions (${matches.length}) share videoRoomName: ${args.videoRoomName}`
      );
    }
    const session = matches[0];

    if (session.callEndedAt !== undefined) {
      return null;
    }

    const instructor = await ctx.db.get(session.instructorId);
    if (instructor && instructor.userId === identity.tokenIdentifier) {
      return { sessionId: session._id, role: "owner" };
    }

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", session.studentId))
      .collect();

    const matchingWorkspace = workspaces.find(
      (w) => w.instructorId === session.instructorId
    );

    if (
      matchingWorkspace !== undefined &&
      matchingWorkspace.ownerId === identity.tokenIdentifier
    ) {
      return { sessionId: session._id, role: "participant" };
    }

    return null;
  },
});

export type ActiveSessionForWorkspace = {
  sessionId: Id<"sessions">;
  roomName: string;
  roomUrl: string;
  startedAt: number;
};

/**
 * Returns the most recently-started in-progress session for a workspace,
 * or null if there is none. "In progress" means `callStartedAt` is set,
 * within the last 4 hours, and `callEndedAt` is undefined.
 *
 * The workspace must NOT be ended or deleted — even an active session
 * on an ended workspace returns null (the workspace is being torn down).
 *
 * Auth: caller must be the workspace owner (student) OR the workspace's
 * instructor. Anyone else gets null.
 *
 * Powers `GET /api/video/active/[workspaceId]` so the workspace UI
 * can mount the VideoPanel without polling every session.
 */
export const getActiveSessionForWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args): Promise<ActiveSessionForWorkspace | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return null;
    }
    if (workspace.endedAt !== undefined || workspace.deletedAt !== undefined) {
      return null;
    }

    const isOwner = workspace.ownerId === identity.tokenIdentifier;
    let isInstructor = false;
    if (workspace.instructorId !== undefined) {
      const instructor = await ctx.db.get(workspace.instructorId);
      if (instructor && instructor.userId === identity.tokenIdentifier) {
        isInstructor = true;
      }
    }

    if (!isOwner && !isInstructor) {
      return null;
    }

    const activeWindowStart = Date.now() - 4 * 60 * 60 * 1000;

    if (workspace.instructorId === undefined) {
      return null;
    }

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_studentId", (q) => q.eq("studentId", workspace.ownerId))
      .filter((q) =>
        q.and(
          q.eq(q.field("instructorId"), workspace.instructorId!),
          q.gt(q.field("callStartedAt"), activeWindowStart),
          q.eq(q.field("callEndedAt"), undefined)
        )
      )
      .collect();

    if (sessions.length === 0) {
      return null;
    }

    const sorted = sessions.sort((a, b) => {
      const aTime = a.callStartedAt ?? a._creationTime;
      const bTime = b.callStartedAt ?? b._creationTime;
      return bTime - aTime;
    });

    const active = sorted[0];
    if (
      active.videoRoomName === undefined ||
      active.videoRoomUrl === undefined ||
      active.callStartedAt === undefined
    ) {
      return null;
    }

    return {
      sessionId: active._id,
      roomName: active.videoRoomName,
      roomUrl: active.videoRoomUrl,
      startedAt: active.callStartedAt,
    };
  },
});


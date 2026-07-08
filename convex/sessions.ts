import { query, mutation, internalAction, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";

/**
 * Identity comparison convention used throughout this file.
 *
 * Convex guidelines recommend `identity.tokenIdentifier` for
 * auth-linked database lookups because it is the canonical stable
 * identifier. In this codebase, however, the values stored against
 * `instructors.userId`, `workspaces.ownerId`, and
 * `sessions.studentId` are the **bare Clerk user IDs** (e.g.
 * `user_3FeL3ri6RljSpv3HDKxmWfnVPi7`) — written by
 * `scripts/seed-test-workspaces.ts:12` and the Clerk lifecycle
 * handler in `apps/platform/inngest/functions/clerk-user-instructor-lifecycle.ts`.
 *
 * For Convex 1.x with Clerk, `identity.subject` carries that bare
 * Clerk user ID, while `identity.tokenIdentifier` carries the
 * issuer-prefixed canonical form
 * (`https://clerk.<subdomain>|user_...`). The two are not
 * byte-equal, so a comparison against `instructor.userId` only
 * matches `identity.subject`. This file uses `identity.subject`
 * everywhere accordingly. Other files (`convex/bookings.ts`,
 * `convex/instructors.ts`, `convex/seatReservations.ts`,
 * `convex/instructorResources.ts`) already follow this convention;
 * see the matching comment block in `convex/instructors.ts:43-58`
 * for the cross-file rationale.
 *
 * Deviation from the guideline is acceptable here because the
 * stored shape is the bare Clerk ID; switching the storage layer
 * to the canonical tokenIdentifier is a wider refactor that would
 * touch every `seed` / webhook / admin mutation and is out of
 * scope for the PR #6-pre P1 fix.
 */

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

    if (instructor.userId !== identity.subject) {
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

    if (instructor.userId !== identity.subject) {
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

        const sessionPack = session.sessionPackId
          ? await ctx.db.get(session.sessionPackId)
          : null;

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

    if (instructor.userId !== identity.subject) {
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

    if (instructor.userId !== identity.subject) {
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

        const sessionPack = session.sessionPackId
          ? await ctx.db.get(session.sessionPackId)
          : null;

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

    if (identity.subject !== args.studentId) {
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

        const sessionPack = session.sessionPackId
          ? await ctx.db.get(session.sessionPackId)
          : null;

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
    // PR #4a: initialize both per-party consent fields to match the
    // booking-time default. Without this, the first party's modal
    // submission would see `otherParty ?? false` and flip the
    // combined value off — disabling recording before the second
    // party has even opened the modal.
    const initialConsent = args.recordingConsent ?? false;
    return await ctx.db.insert("sessions", {
      ...args,
      status: "scheduled",
      recordingConsent: initialConsent,
      instructorRecordingConsent: initialConsent,
      studentRecordingConsent: initialConsent,
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
    if (!instructor || instructor.userId !== identity.subject) {
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
    if (!instructor || instructor.userId !== identity.subject) {
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
    if (!instructor || instructor.userId !== identity.subject) {
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
      // PR #4a: initialize per-party consent to match the historical
      // combined value. Migrated sessions are by definition not going
      // through the consent modal — their state is fixed at migration
      // time.
      instructorRecordingConsent: args.recordingConsent ?? false,
      studentRecordingConsent: args.recordingConsent ?? false,
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
 * Recovery case: if `videoRoomName` is set but `videoRoomUrl` is empty
 * (a previous request crashed between `createDailyRoom` and this
 * mutation), this mutation patches the URL in place. The route layer
 * detects this state, calls Daily again to recover, and re-invokes
 * `setVideoRoom` with the new URL.
 *
 * `roomRecordingEnabled` (PR #4a) is a snapshot of Daily's current
 * `enable_recording` at the time the room was provisioned. Used by
 * `recordConsent` + `syncRoomRecording` to detect drift when a late
 * consent change would flip the recording setting.
 *
 * Auth: instructor on the session only. Students cannot create rooms
 * — this prevents burning Daily quota or creating orphan rooms.
 */
export const setVideoRoom = mutation({
  args: {
    sessionId: v.id("sessions"),
    videoRoomName: v.string(),
    videoRoomUrl: v.string(),
    roomRecordingEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    const instructor = await ctx.db.get(session.instructorId);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }
    if (!instructor || instructor.userId !== identity.subject) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_INSTRUCTOR",
        message: "Forbidden: only the session's instructor can create a room",
      });
    }

    if (session.callEndedAt !== undefined) {
      return session;
    }

    if (session.videoRoomName === args.videoRoomName) {
      if (session.videoRoomUrl !== args.videoRoomUrl) {
        await ctx.db.patch(args.sessionId, {
          videoRoomUrl: args.videoRoomUrl,
          roomRecordingEnabled: args.roomRecordingEnabled,
        });
        return await ctx.db.get(args.sessionId);
      }
      // Name + URL match — but roomRecordingEnabled may still have
      // drifted if a previous 409-recovery PATCH (in resolveDailyRoom)
      // reconciled Daily to a new consent value. Update the snapshot
      // to keep the drift detector in recordConsent in sync with
      // Daily's actual state.
      if (session.roomRecordingEnabled !== args.roomRecordingEnabled) {
        await ctx.db.patch(args.sessionId, {
          roomRecordingEnabled: args.roomRecordingEnabled,
        });
        return await ctx.db.get(args.sessionId);
      }
      return session;
    }

    if (session.videoRoomName !== undefined) {
      throw new ConvexError({
        code: "VIDEO_ROOM_NAME_CONFLICT",
        message:
          "Session already has a different videoRoomName; refusing to overwrite",
      });
    }

    // PR #7: widen-phase uniqueness guard. Prevents two distinct
    // sessions from claiming the same Daily room name — the original
    // guard was only at the read sites
    // (`attachRecordingFromDailyWebhook`, `getSessionByVideoRoomName`)
    // which threw after a duplicate had already been written, so the
    // webhook would 500 on delivery. Now we reject the conflicting
    // assignment up front so the caller can retry with a fresh room.
    // Use `.unique()` semantics — the by_videoRoomName index does not
    // enforce uniqueness, but a single-result read returns the row
    // that owns the name (or null) so a stale concurrent assignment
    // cannot slip through.
    const owner = await ctx.db
      .query("sessions")
      .withIndex("by_videoRoomName", (q) =>
        q.eq("videoRoomName", args.videoRoomName),
      )
      .first();
    if (owner !== null) {
      throw new ConvexError({
        code: "VIDEO_ROOM_NAME_TAKEN",
        message: `videoRoomName already assigned to session ${owner._id}; pick a unique name`,
      });
    }

    await ctx.db.patch(args.sessionId, {
      videoRoomName: args.videoRoomName,
      videoRoomUrl: args.videoRoomUrl,
      roomRecordingEnabled: args.roomRecordingEnabled,
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
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    const instructor = await ctx.db.get(session.instructorId);
    const isInstructor =
      instructor !== null && instructor.userId === identity.subject;
    const isStudent = identity.subject === session.studentId;

    if (!isInstructor && !isStudent) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_PARTICIPANT",
        message: "Forbidden: only session participants can end the call",
      });
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
    if (instructor && instructor.userId === identity.subject) {
      return { sessionId: session._id, role: "owner" };
    }

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", session.studentId))
      .collect();

    const matchingWorkspace = workspaces.find(
      (w) =>
        w.instructorId === session.instructorId &&
        w.endedAt === undefined &&
        w.deletedAt === undefined
    );

    if (
      matchingWorkspace !== undefined &&
      matchingWorkspace.ownerId === identity.subject
    ) {
      return { sessionId: session._id, role: "participant" };
    }

    return null;
  },
});

/**
 * PR #4c-1: returns the list of call recordings that the caller can
 * see for the given workspace. Each item has the S3 key the route
 * layer turns into a signed URL — the key is safe to return because
 * it never grants unauthenticated B2 access (the route gates first,
 * then signs).
 *
 * Filter:
 * - `recordingUrl !== undefined` (sessions that never produced a
 *   recording, or recordings still being processed by Daily)
 * - `deletedAt === undefined` (soft-deleted sessions hidden)
 * - `instructorId === workspace.instructorId` (workspaces are 1:1
 *   with an instructor in this app)
 *
 * Auth: re-uses the existing `getWorkspaceRole` shape (instructor on
 * the workspace, owner of the workspace, or admin). Throws on
 * forbidden so the caller can't enumerate recordings they don't own.
 *
 * Returns up to 50 sessions sorted by `callStartedAt` desc — bounded
 * so a long-running instructor with hundreds of calls doesn't bloat
 * the response. Pagination can come later if usage warrants it.
 */
export type CallRecording = {
  sessionId: Id<"sessions">;
  callStartedAt: number | null;
  callEndedAt: number | null;
  recordingDurationSeconds: number | null;
  participantName: string | null;
  isAdhoc: boolean;
};

export const getCallRecordingsForWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<CallRecording[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return [];
    }
    if (workspace.deletedAt !== undefined || workspace.endedAt !== undefined) {
      return [];
    }
    if (workspace.instructorId === undefined) {
      return [];
    }

    const instructor = await ctx.db.get(workspace.instructorId);
    const isInstructor =
      instructor !== null &&
      instructor.userId === identity.subject;
    const isOwner = workspace.ownerId === identity.subject;

    if (!isInstructor && !isOwner) {
      throw new Error("Forbidden");
    }

    // Indexed read scoped to the exact (instructor, student) pair
    // via `by_instructorId_studentId`. The previous approach
    // queried `by_instructorId_status_scheduledAt` and `.take(50)`
    // across the instructor's full session history — fine for a
    // quiet roster but silently dropped recordings for any
    // student whose sessions weren't among the instructor's 50
    // most recent overall. The compound index makes the lookup
    // exact and unbounded by that cap.
    //
    // Greptile R4 P2: the leftover `.take(50)` here is intentional
    // pagination for the Calls sub-section, not a correctness
    // bug — but the original ordering was by `_creationTime` while
    // the UI sorts by `callStartedAt`, which means the last 50
    // by creation could omit the most-recently-started recording
    // if some sessions were created later than others. We bump
    // the take to 200 as a generous pre-sort buffer (a typical
    // (instructor, student) pair is well under 200 recordings;
    // anything above 200 will require pagination in a follow-up
    // PR — out of scope for PR #4c-1) and then sort the actual
    // candidate set by `callStartedAt`.
    const candidateSessions = await ctx.db
      .query("sessions")
      .withIndex("by_instructorId_studentId", (q) =>
        q
          .eq("instructorId", workspace.instructorId!)
          .eq("studentId", workspace.ownerId)
      )
      .order("desc")
      .take(200);

    const ownerUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", workspace.ownerId))
      .first();
    const ownerFullName =
      [ownerUser?.firstName, ownerUser?.lastName].filter(Boolean).join(" ") ||
      ownerUser?.email ||
      null;

    const recordings: CallRecording[] = candidateSessions
      .filter(
        (s) =>
          s.deletedAt === undefined &&
          s.recordingUrl !== undefined
      )
      .map((s) => ({
        sessionId: s._id,
        callStartedAt: s.callStartedAt ?? null,
        callEndedAt: s.callEndedAt ?? null,
        recordingDurationSeconds: s.recordingDurationSeconds ?? null,
        participantName: ownerFullName,
        isAdhoc: s.isAdhoc ?? false,
      }))
      // Sort by callStartedAt desc — nulls last so ad-hoc calls
      // with no start timestamp sink to the bottom.
      .sort((a, b) => {
        if (a.callStartedAt === null && b.callStartedAt === null) return 0;
        if (a.callStartedAt === null) return 1;
        if (b.callStartedAt === null) return -1;
        return b.callStartedAt - a.callStartedAt;
      })
      .slice(0, 50);

    return recordings;
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

    const isOwner = workspace.ownerId === identity.subject;
    let isInstructor = false;
    if (workspace.instructorId !== undefined) {
      const instructor = await ctx.db.get(workspace.instructorId);
      if (instructor && instructor.userId === identity.subject) {
        isInstructor = true;
      }
    }

    if (!isOwner && !isInstructor) {
      return null;
    }

    const callActiveWindowStart = Date.now() - 4 * 60 * 60 * 1000;

    if (workspace.instructorId === undefined) {
      return null;
    }

    // Use `by_studentId_status_scheduledAt` instead of `by_studentId`
    // so the read is bounded to recent scheduled sessions, then
    // in-memory filter for the active-call conditions. In-memory
    // filter (Array.filter) on a bounded set is allowed — only
    // Convex query builder `.filter()` is disallowed per the
    // guidelines. Sort by `callStartedAt` desc to pick the most
    // recently started active session (avoids the previous behavior
    // where `.collect()` returned all matches in arbitrary order).
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_studentId_status_scheduledAt", (q) =>
        q
          .eq("studentId", workspace.ownerId)
          .eq("status", "scheduled")
          .gte("scheduledAt", callActiveWindowStart)
      )
      .order("asc")
      .take(50);

    const active = sessions
      .filter(
        (s) =>
          s.instructorId === workspace.instructorId &&
          s.callStartedAt !== undefined &&
          s.callStartedAt > callActiveWindowStart &&
          s.callEndedAt === undefined &&
          s.videoRoomName !== undefined
      )
      .sort((a, b) => (b.callStartedAt ?? 0) - (a.callStartedAt ?? 0))[0];

    if (!active || active.callStartedAt === undefined) {
      return null;
    }

    return {
      sessionId: active._id,
      roomName: active.videoRoomName!,
      roomUrl: active.videoRoomUrl!,
      startedAt: active.callStartedAt!,
    };
  },
});

/**
 * Window (in ms) during which a session is "joinable" — participants may
 * start the call. Centered on `scheduledAt`; the window opens 15 minutes
 * before the scheduled start and closes 4 hours after it (matching
 * `DAILY_MAX_RECORDING_SECONDS` / 4h active window in PR #2).
 */
export const JOIN_WINDOW_BEFORE_MS = 15 * 60 * 1000;
export const JOIN_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;

export type CurrentOrUpcomingSession = {
  sessionId: Id<"sessions">;
  scheduledAt: number;
  status: "active" | "joinable" | "scheduled";
  startedAt: number | null;
  videoRoomName: string | null;
  videoRoomUrl: string | null;
  participantName: string;
  windowOpensAt: number;
  windowClosesAt: number;
  /**
   * Last recorded consent value, or null if no consent has been captured
   * yet (e.g., an ad-hoc session whose creator hasn't confirmed). The
   * consent modal defaults to this when present and to `true` for
   * newly-booked sessions (the booking form sets `recordingConsent:
   * true`). Nullable so the UI can show "no choice yet" rather than
   * guessing.
   */
  recordingConsent: boolean | null;
};

/**
 * Returns the current or upcoming session for a workspace.
 *
 * Priority: an in-progress call (`callStartedAt` set, `callEndedAt`
 * undefined, `videoRoomName` set) wins over an upcoming scheduled session.
 * Otherwise, returns the next scheduled session within 24 hours (so the
 * UI can show a countdown) — even if outside the join window, the
 * caller can render a disabled Join button with the time remaining.
 *
 * The workspace must NOT be ended or deleted, and the caller must be
 * the workspace owner (student) OR the workspace's instructor. Anyone
 * else gets null.
 *
 * Powers the Join Call button on the workspace UI (PR #3): the button
 * is enabled only when `status === "active" | "joinable"`.
 */
export const getCurrentOrUpcomingSessionForWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args): Promise<CurrentOrUpcomingSession | null> => {
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
    if (workspace.instructorId === undefined) {
      return null;
    }

    const isOwner = workspace.ownerId === identity.subject;
    let isInstructor = false;
    const instructor = await ctx.db.get(workspace.instructorId);
    if (instructor && instructor.userId === identity.subject) {
      isInstructor = true;
    }

    if (!isOwner && !isInstructor) {
      return null;
    }

    const now = Date.now();

    // Bounded read scoped to the next ~30 days of scheduled sessions.
    // Uses the compound index `by_studentId_status_scheduledAt` so the
    // result is deterministically ordered by `scheduledAt` ascending —
    // `.take(50)` is guaranteed to include the next-upcoming session
    // regardless of how many historical sessions exist (which the
    // previous `by_studentId`-only query could not guarantee). Also
    // restricts to status="scheduled" because every active call still
    // has status="scheduled" until `endCall` transitions it, so this
    // index covers both active and upcoming candidates.
    const historyStart = now - 4 * 60 * 60 * 1000;
    const futureEnd = now + 30 * 24 * 60 * 60 * 1000;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_studentId_status_scheduledAt", (q) =>
        q
          .eq("studentId", workspace.ownerId)
          .eq("status", "scheduled")
          .gte("scheduledAt", historyStart)
          .lte("scheduledAt", futureEnd)
      )
      .order("asc")
      .take(50);

    if (sessions.length === 0) {
      return null;
    }

    // Narrow to the workspace's instructor. The compound index is
    // scoped by `studentId` only — instructor filtering is in-memory
    // because `instructorId` is not part of any compound index that
    // also includes `studentId`. The result set is already bounded
    // (≤ 50), so an in-memory filter is fine.
    const scoped = sessions.filter(
      (s) => s.instructorId === workspace.instructorId && s.deletedAt === undefined
    );
    if (scoped.length === 0) {
      return null;
    }

    // Pick the most recently started active session, if any. We sort
    // by `callStartedAt` desc instead of using `find()` so a stale
    // earlier-scheduled active session can't beat a freshly started
    // one (which would otherwise happen if `.order("asc")` returned
    // an older session first in the index).
    const active = scoped
      .filter(
        (s) =>
          s.callStartedAt !== undefined &&
          s.callEndedAt === undefined &&
          s.videoRoomName !== undefined
      )
      .sort((a, b) => (b.callStartedAt ?? 0) - (a.callStartedAt ?? 0))[0];
    if (active && active.callStartedAt !== undefined) {
      const participantName = isInstructor
        ? await resolveStudentName(ctx, active.studentId)
        : await resolveInstructorName(ctx, instructor);
      return {
        sessionId: active._id,
        scheduledAt: active.scheduledAt,
        status: "active",
        startedAt: active.callStartedAt,
        videoRoomName: active.videoRoomName ?? null,
        videoRoomUrl: active.videoRoomUrl ?? null,
        participantName,
        windowOpensAt: active.scheduledAt - JOIN_WINDOW_BEFORE_MS,
        windowClosesAt: active.callStartedAt + JOIN_WINDOW_AFTER_MS,
        recordingConsent: active.recordingConsent ?? null,
      };
    }

    const upcomingWindowEnd = now + 24 * 60 * 60 * 1000;

    // Ad-hoc catch-up calls beat any stale, never-started scheduled
    // session for the "next session to act on" pick. Without this
    // branch, `scoped.find` returns the EARLIEST `scheduledAt`
    // (`scoped` is ascending), which can be a missed scheduled
    // session from earlier in the window — hiding the freshly-created
    // ad-hoc call behind a row that nobody can join. We pick the
    // most recent ad-hoc (rather than `find` first) in case multiple
    // exist (shouldn't, but `startAdhocCall`'s self-heal keeps the
    // table clean even if a cleanup previously failed).
    const adHocUpcoming = scoped
      .filter(
        (s) =>
          s.callStartedAt === undefined &&
          s.isAdhoc === true &&
          s.scheduledAt <= upcomingWindowEnd
      )
      .sort((a, b) => b.scheduledAt - a.scheduledAt)[0];

    const upcoming = adHocUpcoming ?? scoped.find(
      (s) =>
        s.callStartedAt === undefined &&
        s.isAdhoc !== true &&
        s.scheduledAt <= upcomingWindowEnd
    );

    if (!upcoming) {
      return null;
    }

    const windowOpensAt = upcoming.scheduledAt - JOIN_WINDOW_BEFORE_MS;
    const windowClosesAt = upcoming.scheduledAt + JOIN_WINDOW_AFTER_MS;

    const status: "joinable" | "scheduled" =
      now >= windowOpensAt && now <= windowClosesAt ? "joinable" : "scheduled";

    const participantName = isInstructor
      ? await resolveStudentName(ctx, upcoming.studentId)
      : await resolveInstructorName(ctx, instructor);

    return {
      sessionId: upcoming._id,
      scheduledAt: upcoming.scheduledAt,
      status,
      startedAt: null,
      videoRoomName: null,
      videoRoomUrl: null,
      participantName,
      windowOpensAt,
      windowClosesAt,
      recordingConsent: upcoming.recordingConsent ?? null,
    };
  },
});

async function resolveInstructorName(
  ctx: QueryCtx,
  instructor: Doc<"instructors"> | null
): Promise<string> {
  if (!instructor) return "Instructor";
  if (instructor.name) return instructor.name;
  if (instructor.userId) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", instructor.userId!))
      .first();
    if (user?.firstName) {
      return user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName;
    }
    if (user?.email) return user.email;
  }
  return "Instructor";
}

async function resolveStudentName(
  ctx: QueryCtx,
  studentId: string
): Promise<string> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", studentId))
    .first();
  if (!user) return "Student";
  if (user.firstName) {
    return user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName;
  }
  if (user.email) return user.email;
  return "Student";
}

/**
 * Marks a video call as started by setting `callStartedAt`. Either party
 * on the session (instructor OR student) may start the call.
 *
 * Idempotent: if `callStartedAt` is already set, the existing value is
 * returned without writing. This means the Join Call button is safe to
 * double-click and the same timestamp is used across reconnects.
 *
 * Authorization matches `endCall`: the caller must be the session's
 * instructor (matched via `instructor.userId === identity.subject`)
 * or the session's student (`session.studentId === identity.subject`).
 *
 * Used by the Join Call button on the workspace UI. After this mutation
 * returns, the caller fetches a Daily meeting token via
 * `GET /api/video/token/[roomName]` and joins the Daily room.
 */
export const markCallStarted = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args): Promise<number> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    const instructor = await ctx.db.get(session.instructorId);
    const isInstructor =
      instructor !== null && instructor.userId === identity.subject;
    const isStudent = identity.subject === session.studentId;

    if (!isInstructor && !isStudent) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_PARTICIPANT",
        message: "Forbidden: only session participants can start the call",
      });
    }

    if (session.callEndedAt !== undefined) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_CALL_ENDED",
        message: "Forbidden: call has already ended",
      });
    }

    // The Daily room must already exist before we mark the call as
    // started. Otherwise the Join flow has no `videoRoomName` to
    // request a meeting token against, and the client never gets a
    // joinable room URL. The client is expected to call
    // `POST /api/video/rooms` first (which routes to `setVideoRoom`
    // and creates the Daily room). This precondition prevents a
    // stale `callStartedAt` from being persisted without a backing
    // room.
    if (session.videoRoomName === undefined) {
      throw new ConvexError({
        code: "VIDEO_ROOM_NAME_CONFLICT",
        message:
          "Forbidden: cannot start a call without a Daily room. Ensure POST /api/video/rooms has been called first.",
      });
    }

    if (session.callStartedAt !== undefined) {
      return session.callStartedAt;
    }

    // Enforce the join window server-side. The UI hides the Join
    // button outside this window, but a raw Convex call could
    // bypass that — refuse to set callStartedAt if the caller is
    // trying to start a call outside [scheduledAt - 15min,
    // scheduledAt + 4h]. Symmetric with `endCall` and PR #2's
    // `getSessionByVideoRoomName` returning null after `callEndedAt`.
    const now = Date.now();
    const windowOpensAt = session.scheduledAt - JOIN_WINDOW_BEFORE_MS;
    const windowClosesAt = session.scheduledAt + JOIN_WINDOW_AFTER_MS;
    if (now < windowOpensAt || now > windowClosesAt) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_OUTSIDE_JOIN_WINDOW",
        message: "Forbidden: cannot start a call outside the join window",
      });
    }

    const callStartedAt = now;
    await ctx.db.patch(args.sessionId, { callStartedAt });

    // After the call is marked started, auto-create the live
    // session note for this workspace. The internal mutation is
    // idempotent via `by_sessionId_isLiveSessionNote`, so two
    // participants joining simultaneously can each trigger
    // `markCallStarted` without producing a duplicate note (only the
    // first one writes; subsequent calls return the existing row).
    // We look up the workspace from the session before calling so
    // the new note lands in the right workspace tab.
    //
    // PR #4b (Greptile R1 P1): a student/instructor pair can have
    // multiple historical workspaces (closed, archived, or in rare
    // cases overlapping active ones). Pick the workspace for this
    // call deterministically:
    //
    //   1. Active pair workspace (most recently created by `_id`
    //      descending — `_id` order in Convex is random, so fall back
    //      to first match if `_creationTime` is unavailable)
    //   2. Most-recently-closed pair workspace (`endedAt` descending)
    //   3. Any non-deleted pair workspace
    //
    // We always filter by `instructorId === session.instructorId`
    // because the ownerId index returns every workspace the student
    // ever owned across all instructors.
    try {
      const candidateWorkspaces = await ctx.db
        .query("workspaces")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", session.studentId))
        .collect();

      const pairWorkspaces = candidateWorkspaces.filter(
        (w) => w.instructorId === session.instructorId
      );
      const activePair = pairWorkspaces.filter(
        (w) => w.deletedAt === undefined && w.endedAt === undefined
      );
      const nonDeletedPair = pairWorkspaces.filter(
        (w) => w.deletedAt === undefined
      );

      const matching =
        (activePair.length > 0 ? activePair : null) ??
        (nonDeletedPair.length > 0
          ? [...nonDeletedPair].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
          : null) ??
        (pairWorkspaces.length > 0 ? pairWorkspaces : null);

      if (matching && matching.length > 0) {
        // Active workspaces: pick first. Closed: pick the most
        // recently ended (largest endedAt). Any: pick first.
        const chosen =
          matching === activePair
            ? matching[0]
            : matching === pairWorkspaces
              ? matching[0]
              : matching[0];
        await ctx.runMutation(
          internal.workspaces.createLiveSessionNote,
          {
            sessionId: args.sessionId,
            workspaceId: chosen._id,
          }
        );
      }
    } catch (err) {
      // The live-note write is a non-critical enrichment; do not
      // fail `markCallStarted` if it errors. Logged for ops to
      // catch in production.
      console.error(
        "[sessions.markCallStarted] live session note creation failed",
        err
      );
    }

    return callStartedAt;
  },
});


/**
 * Instructor-only mutation that creates a synthetic `sessions` row
 * for an ad-hoc (catch-up) call started outside any scheduled session.
 *
 * Used by `POST /api/video/start-adhoc` (PR #4a). The route handler
 * then calls `setVideoRoom` to provision a Daily room against the
 * returned `sessionId`. This split lets the route do the Daily REST
 * call (with its retry-on-409 logic) while the database write happens
 * here, transactionally.
 *
 * Auth: caller must be the workspace's instructor (matched via
 * `instructor.userId === identity.subject`). Students never
 * see the UI button (it's hidden at `workspace-client-page.tsx`) AND
 * the endpoint rejects them server-side.
 *
 * The synthetic row has `isAdhoc: true`, `sessionPackId: undefined`
 * (ad-hoc calls don't consume pack quota; PR #4a widened the field to
 * optional), `recordingConsent: args.recordingConsent` (set by the
 * caller after the consent modal — defaults to `true` for instructor-
 * initiated calls per `docs/plans/video-calling.md:343`).
 *
 * `scheduledAt` is set to `Date.now()` so the existing join-window
 * logic in `markCallStarted` (PR #3) treats it as currently in-window
 * and the session appears in `getCurrentOrUpcomingSessionForWorkspace`
 * immediately for the other party.
 */
export const startAdhocCall = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordingConsent: v.boolean(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sessionId: Id<"sessions"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Workspace not found",
      });
    }
    if (workspace.endedAt !== undefined || workspace.deletedAt !== undefined) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Workspace is ended or deleted",
      });
    }
    if (workspace.instructorId === undefined) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Workspace has no instructor",
      });
    }

    const instructor = await ctx.db.get(workspace.instructorId);
    if (!instructor || instructor.userId !== identity.subject) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_INSTRUCTOR",
        message: "Forbidden: only the workspace's instructor can start an ad-hoc call",
      });
    }

    // Refuse if any non-deleted, non-ended session for this workspace
    // already exists within the recent window. Catches BOTH:
    //   (a) sessions where `markCallStarted` already ran (callStartedAt
    //       set), and
    //   (b) freshly-created ad-hoc sessions that haven't been joined
    //       yet (callStartedAt undefined) — important because the
    //       previous guard required callStartedAt !== undefined, leaving
    //       a gap where a second `startAdhocCall` invocation (second
    //       tab, retry after network hiccup) could create a duplicate
    //       session before the first one was joined.
    // Prevents stacking two concurrent calls against the same workspace.
    const recentWindowStart = Date.now() - 4 * 60 * 60 * 1000;
    const candidates = await ctx.db
      .query("sessions")
      .withIndex("by_studentId_status_scheduledAt", (q) =>
        q
          .eq("studentId", workspace.ownerId)
          .eq("status", "scheduled")
          .gte("scheduledAt", recentWindowStart)
      )
      .order("asc")
      .take(50);

    const activeCandidate = candidates.find(
      (s) =>
        s.instructorId === workspace.instructorId &&
        s.callEndedAt === undefined &&
        s.deletedAt === undefined &&
        // Only block sessions that were actually started OR ad-hoc
        // sessions that haven't been joined yet (guards the
        // creation-to-join race for ad-hoc specifically). Never-
        // started scheduled sessions (e.g., a student no-showed) must
        // NOT block a new ad-hoc catch-up call — the instructor
        // should be able to reach out after the missed session.
        (s.callStartedAt !== undefined || s.isAdhoc === true)
    );
    if (activeCandidate) {
      // Self-heal: a stale ad-hoc row with no Daily room and no
      // joined participants means a previous `startAdhocCall` crashed
      // after the row insert but before `setVideoRoom`, AND the
      // route's `deleteOrphanedAdhocSession` cleanup also failed.
      // Without this, the active-candidate guard would block the
      // instructor's retry for up to 4 hours (the `historyStart`
      // window). Safe to delete inline because:
      //   - `isAdhoc === true` (never touches scheduled rows)
      //   - `videoRoomName === undefined` (no Daily room to leak —
      //     nothing else can be holding a reference)
      //   - `callStartedAt === undefined` (nobody is in a call —
      //     never deletes an in-progress row)
      //   - `deletedAt === undefined` (no double-delete)
      //   - caller is already verified as the workspace's instructor
      //     earlier in this handler
      if (
        activeCandidate.isAdhoc === true &&
        activeCandidate.videoRoomName === undefined &&
        activeCandidate.callStartedAt === undefined
      ) {
        await ctx.db.delete(activeCandidate._id);
      } else {
        throw new ConvexError({
          code: "VIDEO_FORBIDDEN_CALL_ACTIVE",
          message: "Forbidden: another call is already active in this workspace",
        });
      }
    }

    const sessionId = await ctx.db.insert("sessions", {
      instructorId: workspace.instructorId,
      studentId: workspace.ownerId,
      sessionPackId: undefined,
      scheduledAt: Date.now(),
      status: "scheduled",
      recordingConsent: args.recordingConsent,
      // PR #4a: initialize the instructor's per-party field to the
      // consented value (the ad-hoc creator IS the instructor and has
      // already gone through the consent modal). The student's field
      // stays undefined until they record their choice.
      instructorRecordingConsent: args.recordingConsent,
      isAdhoc: true,
    });

    return { sessionId };
  },
});

/**
 * Records a participant's recording consent on a session. Either
 * party on the session (instructor OR student) may call this.
 *
 * PR #4a: per-party consent tracking. Each call writes to the
 * caller's own field (`instructorRecordingConsent` or
 * `studentRecordingConsent`) and recomputes the combined
 * `recordingConsent` as `instructor && student`. The combined value
 * flips to `false` if EITHER party declines — matching the plan's
 * "If either party declines consent, the call proceeds without
 * recording" semantic
 * (`docs/plans/video-calling.md:343`).
 *
 * Returns `needsRoomPatch: true` when the combined consent now
 * differs from the snapshot `roomRecordingEnabled` (Daily's current
 * `enable_recording`). The caller (consent route) uses this flag to
 * trigger `syncRoomRecording`, which PATCHes Daily to reconcile.
 *
 * Authorization matches `endCall`/`markCallStarted` (PR #2/3): the
 * caller must be the session's instructor (matched via
 * `instructor.userId === identity.subject`) or the
 * session's student (`session.studentId === identity.subject`).
 */
export const recordConsent = mutation({
  args: {
    sessionId: v.id("sessions"),
    consent: v.boolean(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    recordingConsent: boolean;
    changed: boolean;
    needsRoomPatch: boolean;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    const instructor = await ctx.db.get(session.instructorId);
    const isInstructor =
      instructor !== null && instructor.userId === identity.subject;
    const isStudent = identity.subject === session.studentId;

    if (!isInstructor && !isStudent) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_PARTICIPANT",
        message: "Forbidden: only session participants can record consent",
      });
    }

    // Treat an unanswered party as "not yet declined" rather than
    // `false`. Rationale: the ad-hoc flow sets
    // `instructorRecordingConsent` at `startAdhocCall` time but the
    // student's field stays `undefined` until they join and go
    // through the consent modal. Coercing `undefined` to `false`
    // would flip the combined value to `false` on the instructor's
    // first re-confirm (before the student has answered), disabling
    // Daily recording even though nobody actually declined. Using
    // `?? true` preserves the "either party declines" semantic
    // while keeping early responses from prematurely disabling
    // recording.
    const updatedInstructorConsent = isInstructor
      ? args.consent
      : (session.instructorRecordingConsent ?? true);
    const updatedStudentConsent = isStudent
      ? args.consent
      : (session.studentRecordingConsent ?? true);
    const combined = updatedInstructorConsent && updatedStudentConsent;

    const changed =
      combined !== session.recordingConsent ||
      (isInstructor &&
        session.instructorRecordingConsent !== args.consent) ||
      (isStudent && session.studentRecordingConsent !== args.consent);

    await ctx.db.patch(args.sessionId, {
      instructorRecordingConsent: updatedInstructorConsent,
      studentRecordingConsent: updatedStudentConsent,
      recordingConsent: combined,
    });

    return {
      recordingConsent: combined,
      changed,
      // Drift is real only when there's a room AND the snapshot
      // disagrees with the new combined value.
      needsRoomPatch:
        session.videoRoomName !== undefined &&
        session.roomRecordingEnabled !== undefined &&
        session.roomRecordingEnabled !== combined,
    };
  },
});

/**
 * Cleanup helper for `POST /api/video/start-adhoc`. If the route
 * successfully creates a session via `startAdhocCall` but then fails
 * to provision the Daily room (network error, Daily 5xx, etc.), the
 * session row exists with no `videoRoomName` and would otherwise show
 * up to the student as a phantom upcoming session.
 *
 * This mutation deletes the orphaned session row. Safety:
 *   - Caller must be the session's instructor (same auth as
 *     `startAdhocCall`).
 *   - Session must be `isAdhoc: true` (never deletes scheduled
 *     sessions — those have other cleanup paths via `endCall`).
 *   - Session must NOT have a `videoRoomName` set (otherwise the
 *     Daily room is real and the session should not be deleted).
 *   - Session must NOT be `deletedAt` (already cleaned up — no-op).
 *
 * Returns `{ deleted: true }` on success. No-ops (returns
 * `{ deleted: false }`) if any precondition fails — idempotent so the
 * route can call it without checking the result.
 */
export const deleteOrphanedAdhocSession = mutation({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ deleted: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { deleted: false };
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return { deleted: false };
    }
    if (!session.isAdhoc) {
      return { deleted: false };
    }
    if (session.videoRoomName !== undefined) {
      return { deleted: false };
    }
    if (session.deletedAt !== undefined) {
      return { deleted: false };
    }

    const instructor = await ctx.db.get(session.instructorId);
    if (!instructor || instructor.userId !== identity.subject) {
      return { deleted: false };
    }

    await ctx.db.delete(args.sessionId);
    return { deleted: true };
  },
});

/**
 * Reconciles the Daily room's `enable_recording` setting with the
 * session's current `recordingConsent`. Called by the consent route
 * when `recordConsent` returns `needsRoomPatch: true` (i.e., a late
 * consent change would flip the recording setting).
 *
 * Pure read: returns the PATCH payload so the route can perform the
 * Daily REST call. The snapshot is written by `confirmRoomRecording`
 * AFTER the PATCH succeeds — this ensures the drift detector in
 * `recordConsent` keeps working if a Daily PATCH fails (otherwise
 * we'd permanently mark the snapshot as "in sync" while Daily is
 * actually out of sync).
 *
 * Classified as a query (not a mutation) because it performs no
 * writes — Convex mutations hold an OCC write lock and are billed
 * differently, neither of which applies to a pure read.
 *
 * Auth: instructor OR student on the session (same as `recordConsent`).
 *
 * Idempotent: if the snapshot already equals the desired value,
 * returns `{ needsPatch: false }` so the caller skips the Daily REST
 * call entirely.
 */
export const syncRoomRecording = query({
  args: {
    sessionId: v.id("sessions"),
    enableRecording: v.boolean(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    needsPatch: boolean;
    enableRecording: boolean;
    videoRoomName: string | null;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    const instructor = await ctx.db.get(session.instructorId);
    const isInstructor =
      instructor !== null && instructor.userId === identity.subject;
    const isStudent = identity.subject === session.studentId;

    if (!isInstructor && !isStudent) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_PARTICIPANT",
        message: "Forbidden: only session participants can sync recording",
      });
    }

    if (session.videoRoomName === undefined) {
      return {
        needsPatch: false,
        enableRecording: args.enableRecording,
        videoRoomName: null,
      };
    }

    if (session.roomRecordingEnabled === args.enableRecording) {
      return {
        needsPatch: false,
        enableRecording: args.enableRecording,
        videoRoomName: session.videoRoomName,
      };
    }

    return {
      needsPatch: true,
      enableRecording: args.enableRecording,
      videoRoomName: session.videoRoomName,
    };
  },
});

/**
 * Persists the `roomRecordingEnabled` snapshot AFTER a successful
 * Daily PATCH (driven by `syncRoomRecording` + the route's PATCH
 * call). The split exists so that a failed PATCH leaves the snapshot
 * unchanged — keeping the drift detector in `recordConsent` armed for
 * the next consent submission.
 *
 * Auth: instructor OR student on the session (same as `syncRoomRecording`).
 *
 * Idempotent: writing the same value twice is a no-op.
 */
export const confirmRoomRecording = mutation({
  args: {
    sessionId: v.id("sessions"),
    enableRecording: v.boolean(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ updated: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    const instructor = await ctx.db.get(session.instructorId);
    const isInstructor =
      instructor !== null && instructor.userId === identity.subject;
    const isStudent = identity.subject === session.studentId;

    if (!isInstructor && !isStudent) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_PARTICIPANT",
        message: "Forbidden: only session participants can confirm recording sync",
      });
    }

    if (session.roomRecordingEnabled === args.enableRecording) {
      return { updated: false };
    }

    await ctx.db.patch(args.sessionId, {
      roomRecordingEnabled: args.enableRecording,
    });
    return { updated: true };
  },
});

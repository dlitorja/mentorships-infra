import { query, mutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

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

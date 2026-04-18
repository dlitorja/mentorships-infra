import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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

export const getMentorSessions = query({
  args: { mentorId: v.id("mentors") },
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

export const createSession = mutation({
  args: {
    mentorId: v.id("mentors"),
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

export const deleteSession = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

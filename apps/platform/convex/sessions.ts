import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get sessions by student
export const listByStudent = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("studentId"), args.studentId))
      .collect();
  },
});

// Get upcoming sessions for student
export const listUpcomingByStudent = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db
      .query("sessions")
      .filter((q) =>
        q.and(
          q.eq(q.field("studentId"), args.studentId),
          q.eq(q.field("status"), "scheduled"),
          q.gt(q.field("scheduledAt"), now)
        )
      )
      .collect();
  },
});

// Get sessions by instructor
export const listByInstructor = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();
  },
});

// Get session by ID
export const getById = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Create session
export const create = mutation({
  args: {
    instructorId: v.id("instructors"),
    studentId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    scheduledAt: v.number(),
    recordingConsent: v.boolean(),
    googleCalendarEventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert("sessions", {
      instructorId: args.instructorId,
      studentId: args.studentId,
      sessionPackId: args.sessionPackId,
      scheduledAt: args.scheduledAt,
      status: "scheduled",
      recordingConsent: args.recordingConsent,
      googleCalendarEventId: args.googleCalendarEventId,
    });
    return sessionId;
  },
});

// Complete session
export const complete = mutation({
  args: {
    id: v.id("sessions"),
    recordingUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, recordingUrl, notes } = args;
    await ctx.db.patch(id, {
      status: "completed",
      completedAt: Date.now(),
      recordingUrl,
      notes,
    });
    return await ctx.db.get(id);
  },
});

// Cancel session
export const cancel = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "canceled",
      canceledAt: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

// Update session status
export const updateStatus = mutation({
  args: {
    id: v.id("sessions"),
    status: v.union(
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("canceled"),
      v.literal("no_show")
    ),
  },
  handler: async (ctx, args) => {
    const { id, status } = args;
    const updates: Record<string, unknown> = { status };
    if (status === "completed") updates.completedAt = Date.now();
    if (status === "canceled") updates.canceledAt = Date.now();
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});
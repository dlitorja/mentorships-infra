import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getAssignedInstructors = query({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    if (identity.subject !== args.videoEditorId) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      if (user?.role !== "admin") throw new Error("Forbidden");
    }

    const assignments = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();

    return assignments.map((a) => a.instructorId);
  },
});

export const canVideoEditorAccessInstructor = query({
  args: {
    videoEditorId: v.string(),
    instructorId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    if (identity.subject !== args.videoEditorId) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      if (user?.role !== "admin") return false;
    }

    const assignment = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId).eq("instructorId", args.instructorId)
      )
      .first();

    return assignment !== null;
  },
});

/**
 * Migrates a video editor assignment from legacy system.
 * Updates existing assignment if found by videoEditorId and instructorId, otherwise creates new.
 */
export const migrateVideoEditorAssignment = mutation({
  args: {
    videoEditorId: v.string(),
    instructorId: v.string(),
    assignedAt: v.optional(v.number()),
    assignedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingByEditorInstructor = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId).eq("instructorId", args.instructorId)
      )
      .first();

    if (existingByEditorInstructor) {
      const updates: Record<string, unknown> = {};
      if (args.assignedAt) updates.assignedAt = args.assignedAt;
      if (args.assignedBy !== undefined) updates.assignedBy = args.assignedBy;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByEditorInstructor._id, updates);
      }
      return { action: "updated", id: existingByEditorInstructor._id };
    }

    const insertResult = await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: args.videoEditorId,
      instructorId: args.instructorId,
      assignedAt: args.assignedAt ?? Date.now(),
      assignedBy: args.assignedBy ?? undefined,
    });

    return { action: "inserted", id: insertResult };
  },
});
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

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

export const getVideoEditorAssignments = query({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();
  },
});

export const getAssignedInstructorIds = query({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    const assignments = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();
    return assignments.map((a: Doc<"videoEditorAssignments">) => a.instructorId);
  },
});

export const isVideoEditorAssignedToInstructor = query({
  args: {
    videoEditorId: v.string(),
    instructorId: v.string(),
  },
  handler: async (ctx, args) => {
    const assignment = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId).eq("instructorId", args.instructorId)
      )
      .first();
    return !!assignment;
  },
});
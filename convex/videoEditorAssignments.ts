import { mutation, query } from "./_generated/server";
import type { GenericQueryCtx } from "convex/server";
import { v } from "convex/values";
import type { DataModel, Doc } from "./_generated/dataModel";

interface StorageStats {
  usedBytes: number;
  fileCount: number;
}

function isActiveUpload(upload: Doc<"instructorUploads">): boolean {
  return upload.status !== "deleted" && upload.status !== "deleting";
}

async function requireAdminOrSelf(
  ctx: GenericQueryCtx<DataModel>,
  userId: string
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  if (identity.subject === userId) {
    return;
  }

  const caller = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .first();

  if (!caller || caller.role !== "admin") {
    throw new Error("Forbidden");
  }
}

async function requireAdmin(
  ctx: GenericQueryCtx<DataModel>
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  const caller = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .first();

  if (!caller || caller.role !== "admin") {
    throw new Error("Forbidden");
  }
}

async function computeVideoEditorStorageStats(
  ctx: GenericQueryCtx<DataModel>,
  videoEditorId: string,
  instructorId: string
): Promise<StorageStats> {
  const uploads = await ctx.db
    .query("instructorUploads")
    .withIndex("by_uploadedById_instructorId", (q) =>
      q.eq("uploadedById", videoEditorId).eq("instructorId", instructorId)
    )
    .collect();

  let usedBytes = 0;
  let fileCount = 0;
  for (const upload of uploads) {
    if (isActiveUpload(upload)) {
      usedBytes += upload.size;
      fileCount += 1;
    }
  }

  return { usedBytes, fileCount };
}

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
    storageQuotaBytes: v.optional(v.number()),
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
      if (args.storageQuotaBytes !== undefined) updates.storageQuotaBytes = args.storageQuotaBytes;

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
      storageQuotaBytes: args.storageQuotaBytes ?? undefined,
    });

    return { action: "inserted", id: insertResult };
  },
});

export const getVideoEditorAssignments = query({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    await requireAdminOrSelf(ctx, args.videoEditorId);
    return await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();
  },
});

export const getVideoEditorAssignmentsWithStorage = query({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    await requireAdminOrSelf(ctx, args.videoEditorId);
    const assignments = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();

    const results = [];
    for (const assignment of assignments) {
      const stats = await computeVideoEditorStorageStats(
        ctx,
        assignment.videoEditorId,
        assignment.instructorId
      );
      results.push({
        assignment,
        usedBytes: stats.usedBytes,
        fileCount: stats.fileCount,
      });
    }
    return results;
  },
});

export const getVideoEditorAssignmentWithStorage = query({
  args: {
    videoEditorId: v.string(),
    instructorId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdminOrSelf(ctx, args.videoEditorId);
    const assignment = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId).eq("instructorId", args.instructorId)
      )
      .first();

    if (!assignment) {
      return null;
    }

    const stats = await computeVideoEditorStorageStats(
      ctx,
      assignment.videoEditorId,
      assignment.instructorId
    );

    return {
      assignment,
      usedBytes: stats.usedBytes,
      fileCount: stats.fileCount,
    };
  },
});

export const getVideoEditorStorageStats = query({
  args: {
    videoEditorId: v.string(),
    instructorId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdminOrSelf(ctx, args.videoEditorId);
    return computeVideoEditorStorageStats(ctx, args.videoEditorId, args.instructorId);
  },
});

export const getAssignedInstructorIds = query({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    await requireAdminOrSelf(ctx, args.videoEditorId);
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
    await requireAdminOrSelf(ctx, args.videoEditorId);
    const assignment = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId).eq("instructorId", args.instructorId)
      )
      .first();
    return !!assignment;
  },
});

export const setVideoEditorAssignmentQuota = mutation({
  args: {
    assignmentId: v.id("videoEditorAssignments"),
    storageQuotaBytes: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    const caller = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (!caller || caller.role !== "admin") {
      throw new Error("Forbidden: only admins can manage quotas");
    }

    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) {
      throw new Error("Assignment not found");
    }

    const updates: Record<string, unknown> = {};
    if (args.storageQuotaBytes !== undefined) {
      updates.storageQuotaBytes =
        args.storageQuotaBytes === null ? undefined : args.storageQuotaBytes;
    } else {
      updates.storageQuotaBytes = undefined;
    }

    await ctx.db.patch(assignment._id, updates);
    return { success: true };
  },
});

export const setVideoEditorAssignmentQuotaByIds = mutation({
  args: {
    videoEditorId: v.string(),
    instructorId: v.string(),
    storageQuotaBytes: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    const caller = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (!caller || caller.role !== "admin") {
      throw new Error("Forbidden: only admins can manage quotas");
    }

    const assignment = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", args.videoEditorId).eq("instructorId", args.instructorId)
      )
      .first();

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    const updates: Record<string, unknown> = {};
    if (args.storageQuotaBytes !== undefined) {
      // Convex stores optional numbers; persist null/undefined as unset.
      updates.storageQuotaBytes =
        args.storageQuotaBytes === null ? undefined : args.storageQuotaBytes;
    } else {
      updates.storageQuotaBytes = undefined;
    }

    await ctx.db.patch(assignment._id, updates);
    return { success: true };
  },
});

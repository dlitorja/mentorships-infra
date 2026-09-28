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

  // The caller may authenticate with a Clerk ID that differs from the
  // canonical users.userId used to key assignments. Allow access when the
  // caller's userId matches the requested userId or the caller is an admin.
  const caller = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .first();
  const callerByClerkId = caller ?? await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (callerByClerkId?.userId === userId || callerByClerkId?.clerkId === userId) {
    return;
  }

  if (!callerByClerkId || callerByClerkId.role !== "admin") {
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
  const callerByClerkId = caller ?? await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (!callerByClerkId || callerByClerkId.role !== "admin") {
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
 * Sum usage across every instructor that this video editor uploaded to.
 * Used by the admin UI for an "open" assignment row (where the assignment
 * itself has no `instructorId`), so the storage accounting reflects the
 * editor's actual footprint instead of reporting zero.
 *
 * Uses `.collect()` over the `by_uploadedById` index, mirroring the
 * per-instructor helper below. The cost is O(N) where N is the editor's
 * total upload history (active + deleted). For very long-lived editors
 * with thousands of historical rows this could exceed Convex's response
 * limit; the long-term fix is a precomputed aggregate row updated on
 * createUpload/softDeleteUpload (tracked as a follow-up).
 */
async function computeVideoEditorOpenStorageStats(
  ctx: GenericQueryCtx<DataModel>,
  videoEditorId: string
): Promise<StorageStats> {
  const uploads = await ctx.db
    .query("instructorUploads")
    .withIndex("by_uploadedById", (q) => q.eq("uploadedById", videoEditorId))
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

    // Each row's stats are returned independently so the admin table can
    // show per-instructor usage (for quota review) even when an open row
    // coexists. Aggregate consumers (e.g. /api/storage-usage) MUST
    // de-duplicate when an open row is present: the open row already
    // counts every instructor's uploads, so summing it alongside the
    // specific rows would double-count.
    const results = [];
    for (const assignment of assignments) {
      let stats: StorageStats;
      if (assignment.instructorId === undefined) {
        // Open assignment: sum across every instructor this editor uploaded
        // to. The open row itself has no instructorId, but the storage
        // accounting should reflect the editor's actual footprint.
        stats = await computeVideoEditorOpenStorageStats(ctx, assignment.videoEditorId);
      } else {
        stats = await computeVideoEditorStorageStats(
          ctx,
          assignment.videoEditorId,
          assignment.instructorId
        );
      }
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

    if (!assignment || assignment.instructorId === undefined) {
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

export const getVideoEditorOpenAssignment = query({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    await requireAdminOrSelf(ctx, args.videoEditorId);
    const assignments = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();
    return assignments.find((a) => a.instructorId === undefined) ?? null;
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
    return assignments
      .map((a: Doc<"videoEditorAssignments">) => a.instructorId)
      .filter((id): id is string => id !== undefined);
  },
});

export const isVideoEditorAssignedToInstructor = query({
  args: {
    videoEditorId: v.string(),
    instructorId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdminOrSelf(ctx, args.videoEditorId);
    const assignments = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();
    return assignments.some(
      (a) => a.instructorId === undefined || a.instructorId === args.instructorId
    );
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
    const callerByClerkId = caller ?? await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (!callerByClerkId || callerByClerkId.role !== "admin") {
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
    const callerByClerkId = caller ?? await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (!callerByClerkId || callerByClerkId.role !== "admin") {
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

export const createVideoEditorAssignment = mutation({
  args: {
    videoEditorId: v.string(),
    instructorId: v.optional(v.string()),
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
    const callerByClerkId = caller ?? await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (!callerByClerkId || callerByClerkId.role !== "admin") {
      throw new Error("Forbidden: only admins can manage assignments");
    }

    const editor = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.videoEditorId))
      .first();
    if (!editor || editor.role !== "video_editor") {
      throw new Error("Invalid video editor");
    }

    let existing;
    if (args.instructorId !== undefined) {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", args.instructorId))
        .first();
      if (!instructor) {
        throw new Error("Invalid instructor");
      }
      existing = await ctx.db
        .query("videoEditorAssignments")
        .withIndex("by_videoEditorId_instructorId", (q) =>
          q.eq("videoEditorId", args.videoEditorId).eq("instructorId", args.instructorId as string)
        )
        .first();
    } else {
      const openAssignments = await ctx.db
        .query("videoEditorAssignments")
        .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
        .collect();
      existing = openAssignments.find((a) => a.instructorId === undefined);
    }
    if (existing) {
      return { action: "exists", id: existing._id };
    }

    const id = await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: args.videoEditorId,
      instructorId: args.instructorId,
      assignedAt: Date.now(),
      assignedBy: callerByClerkId.userId,
    });
    return { action: "created", id };
  },
});

export const removeVideoEditorOpenAssignment = mutation({
  args: { videoEditorId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    const caller = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    const callerByClerkId = caller ?? await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (!callerByClerkId || callerByClerkId.role !== "admin") {
      throw new Error("Forbidden: only admins can manage assignments");
    }

    const openAssignments = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", args.videoEditorId))
      .collect();
    const openRow = openAssignments.find((a) => a.instructorId === undefined);
    if (!openRow) {
      return { action: "not_found" as const };
    }
    await ctx.db.delete(openRow._id);
    return { action: "deleted" as const, id: openRow._id };
  },
});

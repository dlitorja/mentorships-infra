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
  requestedId: string
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  // Resolve the caller via both indexes. The Clerk `subject` may be stored
  // as either `users.userId` (apps/platform writes Clerk IDs directly into
  // userId) or `users.clerkId` (huckleberry-drive keeps the two distinct
  // for onboarding splits).
  const caller =
    (await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first()) ??
    (await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first());
  if (!caller) {
    throw new Error("Forbidden: caller is not in the users table");
  }
  if (caller.role === "admin") {
    return;
  }

  // The caller is the target if `requestedId` matches either of the
  // caller's own identifiers (canonical `userId` or Clerk `clerkId`).
  // The Clerk subject we resolved `caller` from can be either of those
  // (the resolver above tries both indexes), so a match on either side
  // means the caller is acting on their own data. A separate target-row
  // lookup is intentionally omitted: target-by-`userId` finding the
  // caller's row implies `caller.userId === requestedId`, and likewise
  // for `clerkId` — both already covered by the arg-match below. Adding
  // it would be up to two extra indexed reads on every non-admin call.
  if (caller.userId === requestedId || caller.clerkId === requestedId) {
    return;
  }

  throw new Error("Forbidden");
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
 * HUC-58: reads the denormalized counter. Falls back to a paginated
 * scan and self-heals by writing the counter if no row exists yet
 * (matches `getVideoEditorTotalStorageStats`).
 */
async function computeVideoEditorOpenStorageStats(
  ctx: GenericQueryCtx<DataModel>,
  videoEditorId: string
): Promise<StorageStats> {
  const counter = await ctx.db
    .query("videoEditorStorageStats")
    .withIndex("by_videoEditorId", (q) =>
      q.eq("videoEditorId", videoEditorId)
    )
    .first();

  if (counter) {
    return { usedBytes: counter.usedBytes, fileCount: counter.fileCount };
  }

  // Fallback for the gap between deploy and the first cron run.
  // Queries can issue at most ONE paginated query per function
  // execution, so we use a single `.collect()` (round-26 Greptile
  // P1 #1). Bounded by the per-query document-read limit (~32k).
  const rows = await ctx.db
    .query("instructorUploads")
    .withIndex("by_uploadedById", (q) =>
      q.eq("uploadedById", videoEditorId)
    )
    .collect();

  let usedBytes = 0;
  let fileCount = 0;
  for (const upload of rows) {
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
    // Quotas only apply to specific (per-instructor) assignments. Open
    // assignments deliberately have no per-instructor quota, so allowing
    // an admin to set one would create a misleading limit (uploads would
    // ignore it, but the dashboard would display it).
    if (assignment.instructorId === undefined) {
      throw new Error("Cannot set quota on open assignments");
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

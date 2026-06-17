import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

async function getUserRole(ctx: QueryCtx, userId: string): Promise<string | null> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role ?? null;
}

async function getAssignedInstructorIds(ctx: QueryCtx, videoEditorId: string): Promise<string[]> {
  const assignments = await ctx.db
    .query("videoEditorAssignments")
    .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", videoEditorId))
    .collect();
  return assignments.map((a) => a.instructorId);
}

export const getUploadById = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Find upload by clientId (UUID used as external file ID)
    // TODO: add index on clientId for production scale
    const allUploads = await ctx.db.query("instructorUploads").collect();
    const upload = allUploads.find((u) => (u as any).clientId === args.id);
    if (!upload) return null;

    const userRole = await getUserRole(ctx, identity.subject);
    if (!userRole) return null;

    if (userRole === "admin") return upload;
    if (userRole === "instructor" && upload.instructorId === identity.subject) return upload;
    if (userRole === "video_editor") {
      const assigned = await getAssignedInstructorIds(ctx, identity.subject);
      if (assigned.includes(upload.instructorId)) return upload;
    }
    // Don't throw - return null so caller can distinguish forbidden from not found
    return null;
  },
});

export const listUploads = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userRole = await getUserRole(ctx, identity.subject);
    if (!userRole) return [];

    if (userRole === "admin") {
      const uploads = await ctx.db.query("instructorUploads").collect();
      return uploads.filter((u) => u.status !== "deleted").slice(0, 100);
    }

    if (userRole === "instructor") {
      const uploads = await ctx.db
        .query("instructorUploads")
        .withIndex("by_instructorId", (q) => q.eq("instructorId", identity.subject))
        .collect();
      return uploads.filter((u) => u.status !== "deleted").slice(0, 100);
    }

    if (userRole === "video_editor") {
      const assignedIds = await getAssignedInstructorIds(ctx, identity.subject);
      if (assignedIds.length === 0) return [];

      const allUploads = await ctx.db.query("instructorUploads").collect();
      return allUploads
        .filter((u) => u.status !== "deleted" && assignedIds.includes(u.instructorId))
        .slice(0, 100);
    }

    return [];
  },
});

export const createUpload = mutation({
  args: {
    clientId: v.string(),
    instructorId: v.string(),
    filename: v.string(),
    originalName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const userRole = await getUserRole(ctx, identity.subject);
    if (!userRole || (userRole !== "admin" && userRole !== "instructor" && userRole !== "video_editor")) {
      throw new Error("Forbidden");
    }

    if (userRole !== "admin" && args.instructorId !== identity.subject) {
      if (userRole === "instructor") throw new Error("Forbidden");
      if (userRole === "video_editor") {
        const assigned = await getAssignedInstructorIds(ctx, identity.subject);
        if (!assigned.includes(args.instructorId)) throw new Error("Forbidden");
      }
    }

    const allUploads = await ctx.db.query("instructorUploads").collect();
    const existing = allUploads.find((u) => (u as any).clientId === args.clientId);
    if (existing) return { id: existing._id, clientId: (existing as any).clientId, alreadyExists: true };

    const id = await ctx.db.insert("instructorUploads", {
      instructorId: args.instructorId,
      filename: args.filename,
      originalName: args.originalName,
      contentType: args.contentType,
      size: args.size,
      status: "pending",
      clientId: args.clientId,
      transferRetryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { id, clientId: args.clientId, alreadyExists: false };
  },
});

export const updateUploadStarted = mutation({
  args: {
    clientId: v.string(),
    b2UploadId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const userRole = await getUserRole(ctx, identity.subject);
    if (!userRole || (userRole !== "admin" && userRole !== "instructor" && userRole !== "video_editor")) {
      throw new Error("Forbidden");
    }

    const allUploads = await ctx.db.query("instructorUploads").collect();
    const upload = allUploads.find((u) => (u as any).clientId === args.clientId);
    if (!upload) throw new Error("Upload not found");

    if (userRole !== "admin" && upload.instructorId !== identity.subject) {
      if (userRole === "video_editor") {
        const assigned = await getAssignedInstructorIds(ctx, identity.subject);
        if (!assigned.includes(upload.instructorId)) throw new Error("Forbidden");
      } else {
        throw new Error("Forbidden");
      }
    }

    await ctx.db.patch(upload._id, {
      b2UploadId: args.b2UploadId,
      status: "uploading",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const completeUpload = mutation({
  args: {
    clientId: v.string(),
    b2FileId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const userRole = await getUserRole(ctx, identity.subject);
    if (!userRole || (userRole !== "admin" && userRole !== "instructor" && userRole !== "video_editor")) {
      throw new Error("Forbidden");
    }

    const allUploads = await ctx.db.query("instructorUploads").collect();
    const upload = allUploads.find((u) => (u as any).clientId === args.clientId);
    if (!upload) throw new Error("Upload not found");

    if (userRole !== "admin" && upload.instructorId !== identity.subject) {
      if (userRole === "video_editor") {
        const assigned = await getAssignedInstructorIds(ctx, identity.subject);
        if (!assigned.includes(upload.instructorId)) throw new Error("Forbidden");
      } else {
        throw new Error("Forbidden");
      }
    }

    await ctx.db.patch(upload._id, {
      b2FileId: args.b2FileId,
      status: "completed",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const softDeleteUpload = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const userRole = await getUserRole(ctx, identity.subject);
    if (!userRole || (userRole !== "admin" && userRole !== "instructor" && userRole !== "video_editor")) {
      throw new Error("Forbidden");
    }

    const allUploads = await ctx.db.query("instructorUploads").collect();
    const upload = allUploads.find((u) => (u as any).clientId === args.clientId);
    if (!upload) throw new Error("Upload not found");

    if (userRole !== "admin" && upload.instructorId !== identity.subject) {
      throw new Error("Forbidden");
    }

    await ctx.db.patch(upload._id, {
      status: "deleted",
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Migrates an instructor upload record from legacy system.
 * Matches by instructorId and createdAt, updates existing record or creates new.
 */
export const migrateInstructorUpload = mutation({
  args: {
    instructorId: v.id("instructors"),
    filename: v.string(),
    originalName: v.string(),
    contentType: v.string(),
    size: v.number(),
    b2FileId: v.optional(v.string()),
    b2UploadId: v.optional(v.string()),
    b2PartEtags: v.optional(v.string()),
    status: v.optional(v.union(v.literal("pending"), v.literal("uploading"), v.literal("completed"), v.literal("archived"), v.literal("failed"), v.literal("deleted"))),
    errorMessage: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    s3Key: v.optional(v.string()),
    s3Url: v.optional(v.string()),
    transferStatus: v.optional(v.union(v.literal("pending"), v.literal("transferring"), v.literal("completed"), v.literal("failed"))),
    transferRetryCount: v.optional(v.number()),
    notifiedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByInstructorCreatedAt = await ctx.db
      .query("instructorUploads")
      .withIndex("by_instructorId", (q) =>
        q.eq("instructorId", args.instructorId)
      )
      .filter((q) => {
        if (!args.createdAt) return q.neq(q.field("_creationTime"), 0);
        return q.eq(q.field("createdAt"), args.createdAt);
      })
      .first();

    if (existingByInstructorCreatedAt) {
      const updates: Record<string, unknown> = {};
      if (args.filename) updates.filename = args.filename;
      if (args.originalName) updates.originalName = args.originalName;
      if (args.contentType) updates.contentType = args.contentType;
      if (args.size) updates.size = args.size;
      if (args.b2FileId !== undefined) updates.b2FileId = args.b2FileId;
      if (args.b2UploadId !== undefined) updates.b2UploadId = args.b2UploadId;
      if (args.b2PartEtags !== undefined) updates.b2PartEtags = args.b2PartEtags;
      if (args.status) updates.status = args.status;
      if (args.errorMessage !== undefined) updates.errorMessage = args.errorMessage;
      if (args.archivedAt) updates.archivedAt = args.archivedAt;
      if (args.s3Key !== undefined) updates.s3Key = args.s3Key;
      if (args.s3Url !== undefined) updates.s3Url = args.s3Url;
      if (args.transferStatus !== undefined) updates.transferStatus = args.transferStatus;
      if (args.transferRetryCount !== undefined) updates.transferRetryCount = args.transferRetryCount;
      if (args.notifiedAt !== undefined) updates.notifiedAt = args.notifiedAt;
      if (args.updatedAt) updates.updatedAt = args.updatedAt;
      if (args.deletedAt !== undefined) updates.deletedAt = args.deletedAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByInstructorCreatedAt._id, updates);
      }
      return { action: "updated", id: existingByInstructorCreatedAt._id };
    }

    const insertResult = await ctx.db.insert("instructorUploads", {
      instructorId: args.instructorId,
      filename: args.filename,
      originalName: args.originalName,
      contentType: args.contentType,
      size: args.size,
      b2FileId: args.b2FileId ?? undefined,
      b2UploadId: args.b2UploadId ?? undefined,
      b2PartEtags: args.b2PartEtags ?? undefined,
      status: args.status ?? "pending",
      errorMessage: args.errorMessage ?? undefined,
      archivedAt: args.archivedAt ?? undefined,
      s3Key: args.s3Key ?? undefined,
      s3Url: args.s3Url ?? undefined,
      transferStatus: args.transferStatus ?? undefined,
      transferRetryCount: args.transferRetryCount ?? 0,
      notifiedAt: args.notifiedAt ?? undefined,
      createdAt: args.createdAt ?? Date.now(),
      updatedAt: args.updatedAt ?? Date.now(),
      deletedAt: args.deletedAt ?? undefined,
    });

    return { action: "inserted", id: insertResult };
  },
});
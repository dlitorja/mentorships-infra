import { mutation } from "./_generated/server";
import { v } from "convex/values";

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
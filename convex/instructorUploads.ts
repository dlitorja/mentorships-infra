import { mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/**
 * Migrates an instructor upload record from legacy system.
 * Matches by instructorId and createdAt, updates existing record or creates new.
 */
export const migrateInstructorUpload = mutation({
  args: {
    instructorId: v.string(),
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

export const getUploadById = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();
  },
});

export const getInstructorUploads = query({
  args: { instructorId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructorUploads")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

export const getUploadsForInstructors = query({
  args: { instructorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.instructorIds.length === 0) return [];
    const allUploads: Doc<"instructorUploads">[] = [];
    for (const instructorId of args.instructorIds) {
      const uploads = await ctx.db
        .query("instructorUploads")
        .withIndex("by_instructorId", (q) => q.eq("instructorId", instructorId))
        .collect();
      allUploads.push(...uploads);
    }
    return allUploads.sort((a, b) => (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime));
  },
});

export const createUpload = mutation({
  args: {
    id: v.string(),
    instructorId: v.string(),
    filename: v.string(),
    originalName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("instructorUploads", {
      instructorId: args.instructorId,
      filename: args.filename,
      originalName: args.originalName,
      contentType: args.contentType,
      size: args.size,
      status: "pending",
      transferRetryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      legacyId: args.id,
    });
    return await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();
  },
});

export const updateUploadStarted = mutation({
  args: {
    id: v.string(),
    b2UploadId: v.string(),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();
    if (!upload) return null;
    await ctx.db.patch(upload._id, {
      b2UploadId: args.b2UploadId,
      status: "uploading",
      updatedAt: Date.now(),
    });
    return await ctx.db.get(upload._id);
  },
});

export const completeUpload = mutation({
  args: {
    id: v.string(),
    b2FileId: v.string(),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();
    if (!upload) return null;
    await ctx.db.patch(upload._id, {
      b2FileId: args.b2FileId,
      status: "completed",
      transferStatus: "pending",
      updatedAt: Date.now(),
    });
    return await ctx.db.get(upload._id);
  },
});

export const softDeleteUpload = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();
    if (!upload) return null;
    await ctx.db.patch(upload._id, {
      status: "deleted",
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return await ctx.db.get(upload._id);
  },
});

export const deleteUpload = mutation({
  args: {
    id: v.string(),
    filename: v.optional(v.string()),
    s3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();

    if (!upload) return { error: "not_found" };
    if (upload.status === "deleted" || upload.status === "deleting") {
      return { error: "already_deleted" };
    }

    await ctx.db.patch(upload._id, {
      status: "deleting",
      deleteAttemptCount: 0,
      updatedAt: Date.now(),
    });

    if (!args.filename && !args.s3Key) {
      await ctx.db.delete(upload._id);
      return { success: true, status: "deleted" };
    }

    ctx.scheduler.runAfter(0, internal.instructorUploads.deleteUploadFromStorage, {
      uploadId: args.id,
      filename: args.filename ?? undefined,
      s3Key: args.s3Key ?? undefined,
    });

    return { success: true, status: "deleting" };
  },
});

export const getUploadByLegacyId = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();
  },
});

export const deleteUploadFromStorage = internalAction({
  args: {
    uploadId: v.string(),
    filename: v.optional(v.string()),
    s3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.runQuery(
      internal.instructorUploads.getUploadByLegacyId,
      { id: args.uploadId }
    );

    if (!upload || upload.status !== "deleting") {
      return;
    }

    const attemptCount = upload.deleteAttemptCount ?? 0;

    try {
      if (args.filename) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { deleteFromB2 } = require("@mentorships/storage/archive");
        await deleteFromB2(args.filename);
      }

      if (args.s3Key) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { deleteFromS3 } = require("@mentorships/storage/archive");
        await deleteFromS3(args.s3Key);
      }

      await ctx.runMutation(internal.instructorUploads.deleteUploadRecord, {
        id: args.uploadId,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`Storage deletion attempt ${attemptCount + 1} failed:`, errorMessage);

      await ctx.runMutation(internal.instructorUploads.recordDeleteFailure, {
        id: args.uploadId,
        error: errorMessage,
        attemptCount: attemptCount + 1,
      });

      if (attemptCount + 1 >= 3) {
        await ctx.runAction(internal.instructorUploads.sendDeleteFailureAlert, {
          uploadId: args.uploadId,
          filename: args.filename ?? undefined,
          s3Key: args.s3Key ?? undefined,
          error: errorMessage,
        });
        await ctx.runMutation(internal.instructorUploads.deleteUploadRecord, {
          id: args.uploadId,
        });
      } else {
        ctx.scheduler.runAfter(3600_000, internal.instructorUploads.deleteUploadFromStorage, {
          uploadId: args.uploadId,
          filename: args.filename ?? undefined,
          s3Key: args.s3Key ?? undefined,
        });
      }
    }
  },
});

export const recordDeleteFailure = internalMutation({
  args: {
    id: v.string(),
    error: v.string(),
    attemptCount: v.number(),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();

    if (!upload) return null;

    await ctx.db.patch(upload._id, {
      deleteAttemptCount: args.attemptCount,
      lastDeleteAttempt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const deleteUploadRecord = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();

    if (!upload) return null;

    await ctx.db.delete(upload._id);
    return { deleted: true };
  },
});

export const sendDeleteFailureAlert = internalAction({
  args: {
    uploadId: v.string(),
    filename: v.optional(v.string()),
    s3Key: v.optional(v.string()),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.runQuery(
      internal.instructorUploads.getUploadByLegacyId,
      { id: args.uploadId }
    );

    let instructorInfo = { name: "Unknown", email: "unknown" };

    if (upload?.instructorId) {
      const user = await ctx.runQuery(
        internal.users.getUserByClerkId,
        { userId: upload.instructorId }
      );
      if (user) {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
        instructorInfo = { name: fullName, email: user.email ?? "unknown" };
      }
    }

    const adminEmail = process.env.ADMIN_ALERT_EMAIL ?? "huckleberryartinc@gmail.com";
    const fromAddress = process.env.EMAIL_FROM ?? "Huckleberry Drive <alerts@huckleberry.art>";

    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error: sendError } = await resend.emails.send({
      from: fromAddress,
      to: [adminEmail],
      subject: `⚠️ File Deletion Failed After Retries: ${instructorInfo.name}`,
      html: `
        <h2>File Deletion Alert</h2>
        <p>An upload deletion failed after 3 retry attempts and required manual cleanup.</p>

        <h3>Details</h3>
        <ul>
          <li><strong>Instructor:</strong> ${instructorInfo.name} (${instructorInfo.email})</li>
          <li><strong>Upload ID:</strong> ${args.uploadId}</li>
          <li><strong>B2 Key:</strong> ${args.filename ?? "N/A"}</li>
          <li><strong>S3 Key:</strong> ${args.s3Key ?? "N/A"}</li>
          <li><strong>Last Error:</strong> ${args.error}</li>
        </ul>

        <p>The Convex record has been deleted. Please verify storage cleanup manually if needed.</p>

        <hr>
        <p style="color: #666; font-size: 12px;">
          This is an automated alert from Huckleberry Drive storage system.
        </p>
      `,
      text: `
File Deletion Alert

An upload deletion failed after 3 retry attempts.

Instructor: ${instructorInfo.name} (${instructorInfo.email})
Upload ID: ${args.uploadId}
B2 Key: ${args.filename ?? "N/A"}
S3 Key: ${args.s3Key ?? "N/A"}
Last Error: ${args.error}

The Convex record has been deleted. Please verify storage cleanup manually if needed.
      `,
    });

    if (sendError) {
      console.error("Failed to send deletion failure email:", sendError);
    }
  },
});
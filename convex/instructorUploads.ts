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
    uploadedById: v.optional(v.string()),
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
      uploadedById: args.uploadedById ?? undefined,
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

    await ctx.scheduler.runAfter(0, internal.instructorUploads.deleteUploadFromStorage, {
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

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

async function sha256Hex(data: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function toHex(data: Uint8Array): Promise<string> {
  return Array.from(data).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getAwsSigV4Signature(
  secretKey: string,
  accessKeyId: string,
  region: string,
  service: string,
  host: string,
  canonicalUri: string,
  method: string,
  amzDate: string
): Promise<string> {
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await toHex(await hmacSha256(kSigning, stringToSign));

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function deleteFromB2(b2Key: string): Promise<void> {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  const bucket = process.env.B2_BUCKET_NAME || "instructor-uploads";
  const region = process.env.B2_REGION || "us-west-002";
  const endpoint = process.env.B2_ENDPOINT || `https://s3.${region}.backblazeb2.com`;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set");
  }

  const host = `s3.${region}.backblazeb2.com`;
  const encodedKey = encodeURIComponent(b2Key);
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const authorization = await getAwsSigV4Signature(secretAccessKey, accessKeyId, region, "s3", host, canonicalUri, "DELETE", amzDate);

  const url = `${endpoint}${canonicalUri}`;

  console.log("B2 delete request:", { url, host, region, bucket, b2Key, amzDate });

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-date": amzDate,
    },
  });

  console.log("B2 delete response:", response.status, response.statusText);
  const body = await response.text();
  console.log("B2 delete body:", body);

  if (!response.ok && response.status !== 404) {
    throw new Error(`B2 delete failed: ${response.status} ${response.statusText} - ${body}`);
  }
}

async function deleteFromS3(s3Key: string): Promise<void> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing AWS credentials: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set");
  }

  const region = process.env.AWS_S3_REGION || "us-east-1";
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    throw new Error("Missing AWS_S3_BUCKET environment variable");
  }

  const endpoint = process.env.AWS_S3_ENDPOINT || `https://s3.${region}.amazonaws.com`;
  const host = endpoint.includes("amazonaws.com") ? `s3.${region}.amazonaws.com` : new URL(endpoint).host;
  const encodedKey = encodeURIComponent(s3Key);
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const authorization = await getAwsSigV4Signature(secretAccessKey, accessKeyId, region, "s3", host, canonicalUri, "DELETE", amzDate);

  const url = `${endpoint}/${bucket}/${encodedKey}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-date": amzDate,
    },
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`S3 delete failed: ${response.status} ${response.statusText} - ${body}`);
  }
}

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
        await deleteFromB2(args.filename);
      }

      if (args.s3Key) {
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
        await ctx.scheduler.runAfter(3600_000, internal.instructorUploads.deleteUploadFromStorage, {
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

export const getAllUploads = query({
  args: {
    instructorId: v.optional(v.string()),
    uploadedById: v.optional(v.string()),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const instructorId = args.instructorId;
    const uploadedById = args.uploadedById;

    let allUploads: Doc<"instructorUploads">[];

    if (instructorId) {
      allUploads = await ctx.db
        .query("instructorUploads")
        .withIndex("by_instructorId", (q) => q.eq("instructorId", instructorId))
        .collect();
    } else if (uploadedById) {
      allUploads = await ctx.db
        .query("instructorUploads")
        .withIndex("by_uploadedById", (q) => q.eq("uploadedById", uploadedById))
        .collect();
    } else {
      allUploads = await ctx.db.query("instructorUploads").collect();
    }

    const sorted = allUploads.sort(
      (a, b) => (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime)
    );

    let filtered = sorted;
    if (args.status === "deleted") {
      filtered = sorted.filter((u) => u.status === "deleted");
    } else if (args.status !== undefined && args.status !== "all") {
      filtered = sorted.filter((u) => u.status === args.status && u.status !== "deleted");
    }
    // else: no filter, return all uploads (including deleted)

    if (args.search) {
      const searchLower = args.search.toLowerCase();
      filtered = filtered.filter((u) => u.originalName.toLowerCase().includes(searchLower));
    }

    const skipCount = args.cursor ?? 0;
    const paginatedResults = filtered.slice(skipCount, skipCount + limit);
    const hasMore = skipCount + limit < filtered.length;
    const nextCursor = hasMore ? skipCount + limit : null;

    return {
      uploads: paginatedResults,
      nextCursor,
      hasMore,
    };
  },
});

export const getVideoEditorUploads = query({
  args: {
    videoEditorId: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);

    const allUploads = await ctx.db
      .query("instructorUploads")
      .withIndex("by_uploadedById", (q) => q.eq("uploadedById", args.videoEditorId))
      .collect();

    const sorted = allUploads
      .filter((u) => u.status !== "deleted" && u.status !== "deleting")
      .sort((a, b) => (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime));

    const skipCount = args.cursor ?? 0;
    const paginatedResults = sorted.slice(skipCount, skipCount + limit);
    const hasMore = skipCount + limit < sorted.length;
    const nextCursor = hasMore ? skipCount + limit : null;

    return {
      uploads: paginatedResults,
      nextCursor,
      hasMore,
    };
  },
});

export const getTotalStorageStats = query({
  args: {},
  handler: async (ctx) => {
    const allUploads = await ctx.db.query("instructorUploads").collect();

    let totalFiles = 0;
    let totalBytes = 0;
    let activeBytes = 0;
    let activeFiles = 0;

    for (const upload of allUploads) {
      totalFiles++;
      totalBytes += upload.size;
      if (upload.status !== "deleted" && upload.status !== "deleting") {
        activeFiles++;
        activeBytes += upload.size;
      }
    }

    const instructors = new Set<string>();
    for (const upload of allUploads) {
      if (upload.status !== "deleted" && upload.status !== "deleting") {
        instructors.add(upload.instructorId);
      }
    }

    return {
      totalFiles,
      totalBytes,
      activeFiles,
      activeBytes,
      instructorCount: instructors.size,
    };
  },
});

export const getInstructorStorageStats = query({
  args: { instructorId: v.string() },
  handler: async (ctx, args) => {
    const uploads = await ctx.db
      .query("instructorUploads")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();

    let usedBytes = 0;
    let fileCount = 0;

    for (const upload of uploads) {
      if (upload.status !== "deleted" && upload.status !== "deleting") {
        usedBytes += upload.size;
        fileCount++;
      }
    }

    return { usedBytes, fileCount };
  },
});

export const restoreUpload = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.id))
      .first();

    if (!upload) return { error: "not_found" };

    if (upload.status !== "deleted") {
      return { error: "not_deleted" };
    }

    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    if (upload.deletedAt && Date.now() - upload.deletedAt > sixtyDaysMs) {
      return { error: "grace_period_expired" };
    }

    await ctx.db.patch(upload._id, {
      status: "completed",
      deletedAt: undefined,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const hardDeleteUpload = mutation({
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

    await ctx.db.patch(upload._id, {
      status: "deleting",
      updatedAt: Date.now(),
    });

    if (!args.filename && !args.s3Key) {
      await ctx.db.delete(upload._id);
      return { success: true, status: "deleted" };
    }

    await ctx.scheduler.runAfter(0, internal.instructorUploads.deleteUploadFromStorage, {
      uploadId: args.id,
      filename: args.filename ?? undefined,
      s3Key: args.s3Key ?? undefined,
    });

    return { success: true, status: "deleting" };
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
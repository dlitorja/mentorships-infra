import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { initiateMultipartUpload, MAX_MULTIPART_UPLOAD_BYTES } from "@mentorships/storage";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { STORAGE_LIMIT_BYTES, isAllowedContentType } from "@/lib/limits";
import { isTurnstileTokenValid, getClientIp } from "@mentorships/security";

interface User {
  userId: string;
  role: string;
}

function getStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = Reflect.get(error, key);
  return typeof value === "string" ? value : undefined;
}

function getMetadataRequestId(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const metadata = Reflect.get(error, "$metadata");
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const requestId = Reflect.get(metadata, "requestId");
  return typeof requestId === "string" ? requestId : undefined;
}

const initiateSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  // Per-file size limit is enforced below so we can return a clear 413 instead
  // of a generic schema validation error.
  size: z.number().positive(),
  instructorId: z.string().trim().min(1).optional(),
  turnstileToken: z.string().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let targetInstructorId: string | undefined;

  try {
    const dbUser = await requireInstructor() as User;
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;
    const body = await request.json();

    const parsed = initiateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { filename, contentType, size, instructorId, turnstileToken } = parsed.data;

    const ip = getClientIp(request);
    const isValid = await isTurnstileTokenValid(turnstileToken, {
      remoteIp: ip,
      action: "upload-initiate",
    });
    if (!isValid) {
      return NextResponse.json(
        { error: "Turnstile verification failed" },
        { status: 401 }
      );
    }

    targetInstructorId = instructorId ?? dbUser.userId;
    const isDelegatedUpload = dbUser.userId !== targetInstructorId;

    if (isDelegatedUpload) {
      if (dbUser.role === "instructor") {
        return NextResponse.json(
          { error: "Instructors can only upload to their own storage" },
          { status: 403 }
        );
      }
      if (dbUser.role === "video_editor") {
        const assignmentWithStorage = await fetchQuery(
          api.videoEditorAssignments.getVideoEditorAssignmentWithStorage,
          { videoEditorId: dbUser.userId, instructorId: targetInstructorId },
          { token: convexToken }
        );
        if (!assignmentWithStorage?.assignment) {
          return NextResponse.json(
            { error: "You are not assigned to this instructor" },
            { status: 403 }
          );
        }
        const quota = assignmentWithStorage.assignment.storageQuotaBytes;
        if (quota !== undefined && quota !== null) {
          if (assignmentWithStorage.usedBytes + size > quota) {
            return NextResponse.json(
              { error: "Video editor storage quota exceeded for this instructor" },
              { status: 403 }
            );
          }
        }
      }
    }

    if (!isAllowedContentType(contentType)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: video/mp4, video/quicktime, video/x-msvideo, video/webm, video/x-matroska, video/mpeg" },
        { status: 400 }
      );
    }

    if (size > MAX_MULTIPART_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File too large. Maximum single upload size is 20GB" },
        { status: 413 }
      );
    }

    // PR1: per-instructor storage accounting is enforced inside the
    // `createUpload` mutation so OCC catches concurrent uploads that
    // race past a route-side pre-check. Keep a soft pre-check here
    // for nicer error messages, but treat the mutation as the
    // authoritative gate.
    if (dbUser.role !== "admin") {
      const stats = await fetchQuery(api.instructorUploads.getInstructorStorageStats, {
        instructorId: targetInstructorId,
      }, { token: convexToken }) as { usedBytes: number; fileCount: number };

      if (stats.usedBytes + size > STORAGE_LIMIT_BYTES) {
        return NextResponse.json(
          { error: "Storage limit exceeded. Please delete files or contact support." },
          { status: 403 }
        );
      }
    }

    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileId = crypto.randomUUID();

    const upload = await initiateMultipartUpload({
      fileId,
      filename: sanitizedFilename,
      contentType,
      size,
      instructorId: targetInstructorId,
    });

    await fetchMutation(api.instructorUploads.createUpload, {
      id: fileId,
      instructorId: targetInstructorId,
      filename: upload.key,
      originalName: filename,
      contentType,
      size,
      uploadedById: isDelegatedUpload ? dbUser.userId : undefined,
    }, { token: convexToken });

    await fetchMutation(api.instructorUploads.updateUploadStarted, {
      id: fileId,
      b2UploadId: upload.uploadId,
    }, { token: convexToken });

    return NextResponse.json({
      fileId,
      uploadId: upload.uploadId,
      key: upload.key,
      partSize: upload.partSize,
      partCount: upload.partCount,
      presignedUrls: upload.presignedUrls,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    const code = getStringProperty(error, "code");
    const requestId = getMetadataRequestId(error);
    const name = getStringProperty(error, "name");

    console.error("Upload initiate error:", {
      message: error instanceof Error ? error.message : String(error),
      code,
      requestId,
      name,
      instructorId: targetInstructorId ?? undefined,
    });

    if (error instanceof Error) {
      // Known validation failures surfaced by the storage package. These should
      // be reported as client errors, not server errors.
      if (error.message.includes("Invalid file size")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.message.includes("Maximum 200 parts allowed")) {
        return NextResponse.json(
          { error: "File too large. Maximum single upload size is 20GB" },
          { status: 413 }
        );
      }

      // S3/B2 client errors that indicate a malformed or unsupported request.
      // Provider configuration problems (NoSuchBucket, AccessDenied,
      // InvalidAccessKeyId, SignatureDoesNotMatch) are server-side issues from
      // the user's perspective and are intentionally left as 500 below.
      const clientErrorCodes = new Set([
        "BucketAlreadyExists",
        "BucketAlreadyOwnedByYou",
        "EntityTooLarge",
        "EntityTooSmall",
        "InvalidArgument",
        "InvalidDigest",
        "InvalidObjectState",
        "InvalidRequest",
        "InvalidToken",
        "KeyTooLong",
        "MalformedXML",
        "MethodNotAllowed",
        "NotImplemented",
        "OperationAborted",
        "RequestNotSupported",
      ]);
      const isClientError = code && clientErrorCodes.has(code);
      if (isClientError) {
        return NextResponse.json(
          { error: error.message, ...(code ? { code } : {}) },
          { status: 400 }
        );
      }
      // Server errors (B2 5xx, provider configuration issues, runtime failures)
      // should not leak internal details to the client. Diagnostics are already
      // logged above via console.error.
      return NextResponse.json({ error: "Upload initiation failed" }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
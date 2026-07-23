import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor } from "@/lib/auth";
import { initiateMultipartUpload } from "@mentorships/storage";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { STORAGE_LIMIT_BYTES, isAllowedContentType } from "@/lib/limits";

interface User {
  userId: string;
  role: string;
}

const initiateSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().positive().max(STORAGE_LIMIT_BYTES),
  instructorId: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    const { filename, contentType, size, instructorId } = parsed.data;

    const targetInstructorId = instructorId ?? dbUser.userId;
    const isDelegatedUpload = dbUser.userId !== targetInstructorId;

    if (isDelegatedUpload) {
      if (dbUser.role === "instructor") {
        return NextResponse.json(
          { error: "Instructors can only upload to their own storage" },
          { status: 403 }
        );
      }
      if (dbUser.role === "video_editor") {
        const isAssigned = await fetchQuery(
          api.videoEditorAssignments.isVideoEditorAssignedToInstructor,
          { videoEditorId: dbUser.userId, instructorId: targetInstructorId }
        );
        if (!isAssigned) {
          return NextResponse.json(
            { error: "You are not assigned to this instructor" },
            { status: 403 }
          );
        }
      }
    }

    if (!isAllowedContentType(contentType)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: video/mp4, video/quicktime, video/x-msvideo, video/webm, video/x-matroska, video/mpeg" },
        { status: 400 }
      );
    }

    if (size > STORAGE_LIMIT_BYTES) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 50GB" },
        { status: 400 }
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
      }) as { usedBytes: number; fileCount: number };

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
    console.error("Upload initiate error:", error);

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
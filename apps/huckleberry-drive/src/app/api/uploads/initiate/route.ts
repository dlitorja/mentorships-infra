import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { initiateMultipartUpload } from "@mentorships/storage";

const initiateSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().positive().max(20 * 1024 * 1024 * 1024),
});

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
  "video/mpeg",
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor();
    const body = await request.json();

    const parsed = initiateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { filename, contentType, size } = parsed.data;

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: video/mp4, video/quicktime, video/x-msvideo, video/webm, video/x-matroska, video/mpeg" },
        { status: 400 }
      );
    }

    if (size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20GB" },
        { status: 400 }
      );
    }

    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileId = crypto.randomUUID();

    const upload = await initiateMultipartUpload({
      fileId,
      filename: sanitizedFilename,
      contentType,
      size,
      instructorId: dbUser.id,
    });

    const convex = getConvexClient();

    await convex.mutation(api.instructorUploads.createUpload, {
      clientId: fileId,
      instructorId: dbUser.id,
      filename: upload.key,
      originalName: filename,
      contentType,
      size,
    });

    await convex.mutation(api.instructorUploads.updateUploadStarted, {
      clientId: fileId,
      b2UploadId: upload.uploadId,
    });

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

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
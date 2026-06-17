import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { completeMultipartUpload, type UploadPart } from "@mentorships/storage";

const completeSchema = z.object({
  fileId: z.string().uuid(),
  uploadId: z.string(),
  key: z.string(),
  parts: z.array(
    z.object({
      partNumber: z.number().int().positive(),
      etag: z.string().min(1),
    })
  ),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor();
    const body = await request.json();

    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileId, uploadId, key, parts } = parsed.data;

    const convex = getConvexClient();

    const upload = await convex.query(api.instructorUploads.getUploadById, { id: fileId });
    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    if (upload.instructorId !== dbUser.id && dbUser.role !== "admin") {
      if (dbUser.role === "video_editor") {
        const canAccess = await convex.query(api.videoEditorAssignments.canVideoEditorAccessInstructor, {
          videoEditorId: dbUser.id,
          instructorId: upload.instructorId,
        });
        if (!canAccess) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      } else {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    if (upload.b2UploadId !== uploadId) {
      return NextResponse.json({ error: "Invalid upload ID" }, { status: 400 });
    }

    const result = await completeMultipartUpload({
      key,
      uploadId,
      parts: parts as UploadPart[],
    });

    await convex.mutation(api.instructorUploads.completeUpload, {
      clientId: fileId,
      b2FileId: result.etag.replace(/"/g, ""),
    });

    return NextResponse.json({
      success: true,
      fileId,
      etag: result.etag,
      location: result.location,
    });
  } catch (error) {
    console.error("Upload complete error:", error);

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
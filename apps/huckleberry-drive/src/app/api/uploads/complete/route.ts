import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireInstructor } from "@/lib/auth";
import { completeMultipartUpload, type UploadPart } from "@mentorships/storage";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  instructorId: string;
  b2UploadId?: string;
}

interface User {
  userId: string;
  role: string;
}

const completeSchema = z.object({
  fileId: z.string(),
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
    const dbUser = await requireInstructor() as User;
    const body = await request.json();

    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileId, uploadId, key, parts } = parsed.data;

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id: fileId }) as Upload | null;
    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    if (upload.instructorId !== dbUser.userId && dbUser.role !== "admin") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (upload.b2UploadId !== uploadId) {
      return NextResponse.json({ error: "Invalid upload ID" }, { status: 400 });
    }

    const result = await completeMultipartUpload({
      key,
      uploadId,
      parts: parts as UploadPart[],
    });

    await fetchMutation(api.instructorUploads.completeUpload, { id: fileId, b2FileId: result.etag.replace(/"/g, "") });

    return NextResponse.json({
      success: true,
      fileId,
      etag: result.etag,
      location: result.location,
    });
  } catch (error) {
    console.error("Upload complete error:", error);

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { abortMultipartUpload } from "@mentorships/storage";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  legacyId?: string;
  instructorId: string;
  filename: string;
  b2UploadId?: string;
}

interface User {
  userId: string;
  role: string;
}

const abortSchema = z.object({
  fileId: z.string(),
  uploadId: z.string(),
  key: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor() as User;
    const body = await request.json();

    const parsed = abortSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileId, uploadId, key: providedKey } = parsed.data;

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

    const key = providedKey ?? upload.filename;
    await abortMultipartUpload({ key, uploadId });

    await fetchMutation(api.instructorUploads.softDeleteUpload, { id: fileId });

    return NextResponse.json({
      success: true,
      fileId,
      message: "Upload aborted successfully",
    });
  } catch (error) {
    console.error("Upload abort error:", error);

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
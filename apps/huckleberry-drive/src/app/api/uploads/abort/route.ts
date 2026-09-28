import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, canAccessInstructorData, getCurrentUser, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { abortMultipartUpload } from "@mentorships/storage";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  legacyId?: string;
  instructorId: string;
  filename: string;
  uploadedById?: string;
  status?: string;
  b2UploadId?: string;
}

const abortSchema = z.object({
  fileId: z.string(),
  uploadId: z.string(),
  key: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireInstructor();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;
    const body = await request.json();

    const parsed = abortSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileId, uploadId, key: providedKey } = parsed.data;

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id: fileId }, { token: convexToken }) as Upload | null;
    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    const hasAccess = await canAccessInstructorData(upload.instructorId);
    // Fallback: if the uploader is the caller and the upload is still in a
    // non-terminal state, allow them to abort an in-progress multipart
    // upload that started under open access that has since been revoked.
    // Without this, revoking open access mid-upload strands the B2 multipart
    // state and the editor cannot clean up the dangling session.
    const inProgressStatuses = new Set(["pending", "uploading"]);
    const isInProgress = upload.status ? inProgressStatuses.has(upload.status) : true;
    let isOwnerFinishingOwnUpload = false;
    if (upload.uploadedById !== undefined && isInProgress) {
      const dbUser = await getCurrentUser();
      if (dbUser && upload.uploadedById === dbUser.userId) {
        isOwnerFinishingOwnUpload = true;
      }
    }
    if (!hasAccess && !isOwnerFinishingOwnUpload) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (upload.b2UploadId !== uploadId) {
      return NextResponse.json({ error: "Invalid upload ID" }, { status: 400 });
    }

    const key = providedKey ?? upload.filename;
    await abortMultipartUpload({ key, uploadId });

    await fetchMutation(api.instructorUploads.softDeleteUpload, { id: fileId }, { token: convexToken });

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
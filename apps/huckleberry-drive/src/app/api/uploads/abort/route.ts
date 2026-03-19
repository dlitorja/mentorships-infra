import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMentor } from "@/lib/auth";
import { abortMultipartUpload } from "@mentorships/storage";
import { getUploadById, softDeleteUpload } from "@mentorships/db";
import { UnauthorizedError, ForbiddenError } from "@mentorships/db";

const abortSchema = z.object({
  fileId: z.string().uuid(),
  uploadId: z.string(),
  key: z.string(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const dbUser = await requireMentor();
    const body = await request.json();
    
    const parsed = abortSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    
    const { fileId, uploadId, key } = parsed.data;
    
    const upload = await getUploadById(fileId);
    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }
    
    if (upload.instructorId !== dbUser.id && dbUser.role !== "admin") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    
    if (upload.b2UploadId !== uploadId) {
      return NextResponse.json({ error: "Invalid upload ID" }, { status: 400 });
    }
    
    await abortMultipartUpload({ key, uploadId });
    
    await softDeleteUpload(fileId);
    
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

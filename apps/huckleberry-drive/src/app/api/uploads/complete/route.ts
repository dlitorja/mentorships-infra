import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMentor } from "@/lib/auth";
import { completeMultipartUpload, type UploadPart } from "@mentorships/storage";
import { getUploadById, completeUpload } from "@mentorships/db";

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
    const dbUser = await requireMentor();
    const body = await request.json();
    
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    
    const { fileId, uploadId, key, parts } = parsed.data;
    
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
    
    const result = await completeMultipartUpload({
      key,
      uploadId,
      parts: parts as UploadPart[],
    });
    
    await completeUpload(fileId, result.etag.replace(/"/g, ""));
    
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

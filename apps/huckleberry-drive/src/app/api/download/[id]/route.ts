import { NextRequest, NextResponse } from "next/server";
import { requireMentor, canAccessFile } from "@/lib/auth";
import { getUploadById } from "@mentorships/db";
import { getDownloadUrlWithContentDisposition } from "@mentorships/storage";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireMentor();
    
    const url = new URL(request.url);
    const expiresIn = Math.max(60, Math.min(
      parseInt(url.searchParams.get("expiresIn") || "3600", 10) || 3600,
      86400
    ));
    
    const upload = await getUploadById(id);
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    if (upload.status === "deleted") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    if (upload.status === "archived") {
      return NextResponse.json({
        error: "File is archived in S3 Glacier. Restore required before download." },
        { status: 410 }
      );
    }
    
    if (!upload.filename) {
      return NextResponse.json({ error: "File location unknown" }, { status: 400 });
    }
    
    const hasAccess = await canAccessFile(upload.instructorId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    
    const downloadUrl = await getDownloadUrlWithContentDisposition(
      upload.filename,
      upload.originalName,
      expiresIn
    );
    
    return NextResponse.json({
      url: downloadUrl,
      expiresIn,
      filename: upload.originalName,
    });
  } catch (error) {
    console.error("Download error:", error);
    
    if (error instanceof Error && error.message === "Cannot access this file") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

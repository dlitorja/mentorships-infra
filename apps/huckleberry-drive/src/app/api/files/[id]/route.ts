import { NextRequest, NextResponse } from "next/server";
import { requireMentor, canAccessFile } from "@/lib/auth";
import { getUploadById, softDeleteUpload, type InstructorUpload } from "@mentorships/db";
import { deleteFile } from "@mentorships/storage";
import { ForbiddenError, UnauthorizedError } from "@mentorships/db";

interface Params {
  params: Promise<{ id: string }>;
}

interface FileResponse {
  id: string;
  instructorId: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus: string | null;
  s3Key: string | null;
  s3Url: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  errorMessage: string | null;
}

function formatFileResponse(upload: InstructorUpload): FileResponse {
  return {
    id: upload.id,
    instructorId: upload.instructorId,
    originalName: upload.originalName,
    contentType: upload.contentType,
    size: upload.size,
    status: upload.status,
    transferStatus: upload.transferStatus,
    s3Key: upload.s3Key,
    s3Url: upload.s3Url,
    createdAt: upload.createdAt,
    archivedAt: upload.archivedAt,
    errorMessage: upload.errorMessage,
  };
}

export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireMentor();
    
    const upload = await getUploadById(id);
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    if (upload.status === "deleted") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    const hasAccess = await canAccessFile(upload.instructorId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    
    return NextResponse.json({
      file: formatFileResponse(upload),
    });
  } catch (error) {
    console.error("Get file error:", error);
    
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

export async function DELETE(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const dbUser = await requireMentor();
    
    const upload = await getUploadById(id);
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    if (upload.status === "deleted") {
      return NextResponse.json({ error: "File already deleted" }, { status: 400 });
    }
    
    if (upload.instructorId !== dbUser.id && dbUser.role !== "admin") {
      return NextResponse.json({ error: "Not authorized to delete this file" }, { status: 403 });
    }
    
    if (upload.filename) {
      await deleteFile(upload.filename);
    }
    
    await softDeleteUpload(id);
    
    return NextResponse.json({
      success: true,
      fileId: id,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete file error:", error);
    
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

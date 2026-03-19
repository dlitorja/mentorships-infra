import { NextRequest, NextResponse } from "next/server";
import { requireMentor, canAccessFile } from "@/lib/auth";
import { getUploadById, softDeleteUpload, type InstructorUpload } from "@mentorships/db";
import { deleteFile } from "@mentorships/storage";

interface Params {
  params: Promise<{ id: string }>;
}

async function formatFileResponse(upload: InstructorUpload) {
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
    const dbUser = await requireMentor();
    
    const upload = await getUploadById(id);
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    if (upload.status === "deleted") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    
    await canAccessFile(upload.instructorId);
    
    return NextResponse.json({
      file: await formatFileResponse(upload),
    });
  } catch (error) {
    console.error("Get file error:", error);
    
    if (error instanceof Error && error.message === "Cannot access this file") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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
      try {
        await deleteFile(upload.filename);
      } catch (error) {
        console.error("Failed to delete file from B2:", error);
      }
    }
    
    await softDeleteUpload(id);
    
    return NextResponse.json({
      success: true,
      fileId: id,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete file error:", error);
    
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { deleteFile } from "@mentorships/storage";

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
  createdAt: number | null;
  archivedAt: number | null;
  errorMessage: string | null;
}

function formatFileResponse(upload: any): FileResponse {
  return {
    id: (upload as any).clientId ?? upload._id,
    instructorId: upload.instructorId,
    originalName: upload.originalName,
    contentType: upload.contentType,
    size: upload.size,
    status: upload.status,
    transferStatus: upload.transferStatus ?? null,
    s3Key: upload.s3Key ?? null,
    s3Url: upload.s3Url ?? null,
    createdAt: upload.createdAt ?? null,
    archivedAt: upload.archivedAt ?? null,
    errorMessage: upload.errorMessage ?? null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireInstructor();

    const convex = getConvexClient();
    const upload = await convex.query(api.instructorUploads.getUploadById, { id });

    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (upload.status === "deleted") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
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
  _request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const dbUser = await requireInstructor();

    const convex = getConvexClient();
    const upload = await convex.query(api.instructorUploads.getUploadById, { id });

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

    await convex.mutation(api.instructorUploads.softDeleteUpload, { clientId: id });

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
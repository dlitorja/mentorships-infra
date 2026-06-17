import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, canAccessFile, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  instructorId: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus?: string;
  s3Key?: string;
  s3Url?: string;
  createdAt: number;
  archivedAt?: number;
  errorMessage?: string;
}

interface User {
  _id: string;
  userId: string;
  role: string;
}

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

function formatFileResponse(upload: Upload): FileResponse {
  return {
    id: upload._id,
    instructorId: upload.instructorId,
    originalName: upload.originalName,
    contentType: upload.contentType,
    size: upload.size,
    status: upload.status,
    transferStatus: upload.transferStatus ?? null,
    s3Key: upload.s3Key ?? null,
    s3Url: upload.s3Url ?? null,
    createdAt: new Date(upload.createdAt ?? 0),
    archivedAt: upload.archivedAt ? new Date(upload.archivedAt) : null,
    errorMessage: upload.errorMessage ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireInstructor();

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id }) as Upload | null;
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (upload.status === "deleted" || upload.status === "deleting") {
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
    const dbUser = await requireInstructor() as User;

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id }) as Upload | null;
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (upload.status === "deleted" || upload.status === "deleting") {
      return NextResponse.json({ error: "File already deleted" }, { status: 400 });
    }

    if (upload.instructorId !== dbUser.userId && dbUser.role !== "admin") {
      return NextResponse.json({ error: "Not authorized to delete this file" }, { status: 403 });
    }

    const result = await fetchMutation(api.instructorUploads.deleteUpload, {
      id,
      filename: upload.filename || undefined,
      s3Key: upload.s3Key || undefined,
    });

    if (result.error === "not_found") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      fileId: id,
      message: result.status === "deleted"
        ? "File deleted successfully"
        : "File deletion in progress",
    }, { status: result.status === "deleted" ? 200 : 202 });
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
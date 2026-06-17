import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, canAccessFile, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getDownloadUrlWithContentDisposition } from "@mentorships/storage";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  legacyId?: string;
  instructorId: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus?: string;
  s3Key?: string;
  s3Url?: string;
  b2FileId?: string;
  b2UploadId?: string;
  createdAt?: number;
  archivedAt?: number;
  errorMessage?: string;
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

    const url = new URL(request.url);
    const expiresIn = Math.max(60, Math.min(
      parseInt(url.searchParams.get("expiresIn") || "3600", 10) || 3600,
      86400
    ));

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id }) as Upload | null;
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
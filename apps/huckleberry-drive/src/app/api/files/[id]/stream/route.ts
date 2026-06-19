import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, canAccessFile, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getStreamUrl } from "@mentorships/storage/src/downloads";
import { fetchQuery } from "convex/nextjs";
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
  createdAt?: number;
  archivedAt?: number;
}

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const expiresIn = Math.max(60, Math.min(
      parseInt(url.searchParams.get("expiresIn") || "14400", 10) || 14400,
      86400
    ));

    const dbUser = await requireInstructor() as User;

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id }) as Upload | null;
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (upload.status === "deleted") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (!upload.filename) {
      return NextResponse.json({ error: "File location unknown" }, { status: 400 });
    }

    const hasAccess = await canAccessFile(upload.instructorId);
    if (!hasAccess && dbUser.role !== "admin") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const streamUrl = await getStreamUrl(
      upload.filename,
      upload.contentType,
      expiresIn
    );

    return NextResponse.json({
      url: streamUrl,
      expiresIn,
      contentType: upload.contentType,
      filename: upload.originalName,
    });
  } catch (error) {
    console.error("Stream error:", error);

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
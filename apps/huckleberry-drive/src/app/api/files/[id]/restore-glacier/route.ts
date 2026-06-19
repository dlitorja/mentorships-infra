import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, canAccessFile, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { restoreFromGlacier } from "@mentorships/storage/src/archive";
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

export async function POST(
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

    if (upload.status !== "archived") {
      return NextResponse.json({ error: "File is not archived" }, { status: 400 });
    }

    const hasAccess = await canAccessFile(upload.instructorId);
    if (!hasAccess && dbUser.role !== "admin") {
      return NextResponse.json({ error: "Not authorized to restore this file" }, { status: 403 });
    }

    if (!upload.s3Key) {
      return NextResponse.json({ error: "Archive location unknown" }, { status: 400 });
    }

    const result = await restoreFromGlacier(upload.s3Key, 5);

    return NextResponse.json({
      success: true,
      message: result,
    });
  } catch (error) {
    console.error("Restore from glacier error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
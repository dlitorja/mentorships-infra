import { NextResponse } from "next/server";
import { requireInstructor, getAccessibleInstructorIds, UnauthorizedError, ForbiddenError } from "@/lib/auth";
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
  createdAt?: number;
  archivedAt?: number;
  errorMessage?: string;
}

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface FileResponse {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  errorMessage: string | null;
}

function formatFileResponse(upload: Upload): FileResponse {
  return {
    id: upload.legacyId ?? upload._id,
    originalName: upload.originalName,
    contentType: upload.contentType,
    size: upload.size,
    status: upload.status,
    transferStatus: upload.transferStatus ?? null,
    createdAt: new Date(upload.createdAt ?? 0),
    archivedAt: upload.archivedAt ? new Date(upload.archivedAt) : null,
    errorMessage: upload.errorMessage ?? null,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor() as User;
    const accessibleIds = await getAccessibleInstructorIds();

    let uploads: Upload[];

    if (dbUser.role === "admin") {
      // Admin gets all uploads - placeholder until we add proper admin query
      uploads = [];
    } else if (accessibleIds === null || accessibleIds.length === 0) {
      uploads = await fetchQuery(api.instructorUploads.getInstructorUploads, { instructorId: dbUser.userId }) as Upload[];
    } else {
      uploads = await fetchQuery(api.instructorUploads.getUploadsForInstructors, { instructorIds: accessibleIds }) as Upload[];
    }

    const files = uploads
      .filter((u) => u.status !== "deleted")
      .map(formatFileResponse);

    return NextResponse.json({
      files,
      pagination: {
        total: files.length,
        hasMore: false,
      },
    });
  } catch (error) {
    console.error("List files error:", error);

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
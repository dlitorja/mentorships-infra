import { NextResponse } from "next/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

interface FileResponse {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus: string | null;
  createdAt: number | null;
  archivedAt: number | null;
  errorMessage: string | null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor();

    const convex = getConvexClient();
    const uploads = await convex.query(api.instructorUploads.listUploads, {});

    const files: FileResponse[] = uploads
      .filter((u) => u.status !== "deleted")
      .map((upload) => ({
        id: (upload as any).clientId ?? upload._id,
        originalName: upload.originalName,
        contentType: upload.contentType,
        size: upload.size,
        status: upload.status,
        transferStatus: upload.transferStatus ?? null,
        createdAt: upload.createdAt ?? null,
        archivedAt: upload.archivedAt ?? null,
        errorMessage: upload.errorMessage ?? null,
      }));

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
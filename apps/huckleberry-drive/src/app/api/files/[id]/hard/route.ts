import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery, fetchMutation } from "convex/nextjs";
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

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireAdmin() as User;

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id }) as Upload | null;
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const result = await fetchMutation(api.instructorUploads.hardDeleteUpload, {
      id,
      filename: upload.filename || undefined,
      s3Key: upload.s3Key || undefined,
    }) as { success: true; status: "deleted" | "deleting" } | { error: "not_found" };

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      fileId: id,
      message: result.status === "deleted"
        ? "File permanently deleted"
        : "Permanent deletion in progress",
    }, { status: result.status === "deleted" ? 200 : 202 });
  } catch (error) {
    console.error("Hard delete file error:", error);

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
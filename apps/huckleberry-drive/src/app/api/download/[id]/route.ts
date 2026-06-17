import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { getDownloadUrlWithContentDisposition } from "@mentorships/storage";

interface Params {
  params: Promise<{ id: string }>;
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

    const convex = getConvexClient();
    const upload = await convex.query(api.instructorUploads.getUploadById, { id });

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
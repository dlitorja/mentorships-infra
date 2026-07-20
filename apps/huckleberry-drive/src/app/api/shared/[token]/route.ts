import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireVideoEditorRole, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getDownloadUrlWithContentDisposition } from "@mentorships/storage/src/downloads";

interface Params {
  params: Promise<{ token: string }>;
}

interface UploadInfo {
  filename: string;
  originalName: string;
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    await requireVideoEditorRole();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;
    const { token } = await params;

    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const result = await fetchQuery(api.hdShareLinks.resolveShareByToken, { token }, { token: convexToken });

    if (!result || result.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (result.kind === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (result.kind === "not_found" || result.kind === "file_missing") {
      return NextResponse.json({ error: "Share or file not found" }, { status: 404 });
    }
    if (result.kind === "revoked") {
      return NextResponse.json({ error: "Share revoked" }, { status: 410 });
    }
    if (result.kind === "expired") {
      return NextResponse.json({ error: "Share expired" }, { status: 410 });
    }

    const upload = result.upload as UploadInfo;
    if (!upload.filename) {
      return NextResponse.json({ error: "File location unknown" }, { status: 400 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      undefined;
    const userAgent = request.headers.get("user-agent") ?? undefined;

    await fetchMutation(
      api.hdShareLinks.logShareAccess,
      {
        shareId: result.share.id,
        action: "download",
        ip,
        userAgent,
      },
      { token: convexToken }
    );

    const downloadUrl = await getDownloadUrlWithContentDisposition(
      upload.filename,
      upload.originalName,
      3600
    );

    return NextResponse.redirect(downloadUrl, { status: 302 });
  } catch (error) {
    console.error("Shared download error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

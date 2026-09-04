import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getDownloadUrlWithContentDisposition } from "@mentorships/storage/src/downloads";
import { isTurnstileTokenValid, getClientIp } from "@mentorships/security";

interface Params {
  params: Promise<{ token: string }>;
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    // Role-based access is enforced by `resolveShareByToken` so that
    // the owning instructor can also download shares they receive from
    // video editors. We only require an authenticated Clerk session
    // here to keep Turnstile from being exercised by unauthenticated
    // callers.
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const convexToken = await getToken({ template: "convex" }) ?? undefined;
    const { token } = await params;

    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    let body: { turnstileToken?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    if (!turnstileToken) {
      return NextResponse.json(
        { error: "Turnstile token is required" },
        { status: 401 }
      );
    }

    const ip = getClientIp(request);
    const isValid = await isTurnstileTokenValid(turnstileToken, {
      remoteIp: ip,
      action: "share-download",
    });
    if (!isValid) {
      return NextResponse.json(
        { error: "Turnstile verification failed" },
        { status: 401 }
      );
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

    const { upload } = result;
    if (!upload.filename) {
      return NextResponse.json({ error: "File location unknown" }, { status: 400 });
    }

    const userAgent = request.headers.get("user-agent") ?? undefined;

    try {
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
    } catch (logError) {
      console.error("Failed to log share download:", logError);
    }

    const downloadUrl = await getDownloadUrlWithContentDisposition(
      upload.filename,
      upload.originalName,
      3600
    );

    return NextResponse.json({ downloadUrl });
  } catch (error) {
    console.error("Shared download error:", error);

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

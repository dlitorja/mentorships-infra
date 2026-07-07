import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  getStreamUrl,
  getDownloadUrlWithContentDisposition,
} from "@mentorships/storage";
import { recordingDownloadFilename } from "@/lib/video/recording-filename";
import { reportError, reportInfo } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PR #4c-1: returns a short-lived signed B2 URL for a session's
 * call recording. Two flavours:
 *
 *   ?kind=stream    → `getStreamUrl(key, "video/mp4", 3600)`
 *                     → returned as `<video src>` in the modal.
 *
 *   ?kind=download  → `getDownloadUrlWithContentDisposition(...)`
 *                     → returned as `<a href download>` so the
 *                       browser saves the file with a clean name.
 *
 * Both flavours are 1-hour TTL. The modal auto-refreshes the
 * stream URL every 60s when within 5 min of expiry (see
 * `recording-player-modal.tsx`).
 *
 * Auth: the only callers are participants on the session (the
 * session's instructor OR the workspace owner who is the student).
 * Resolution happens server-side in
 * `api.workspaces.getSessionParticipantForRecording`; we never
 * trust the URL or body to declare identity.
 *
 * Cache: `Cache-Control: no-store` so no intermediate cache holds
 * the signed URL after the route returns. The signed URL itself
 * has its own expiry baked in by `getSignedUrl`, but `no-store` is
 * defence in depth.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const clerkAuth = await auth();
    if (!clerkAuth.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json(
        { error: "Failed to acquire auth token" },
        { status: 401 }
      );
    }

    const { sessionId } = await params;
    if (!sessionId || sessionId.length === 0) {
      return NextResponse.json(
        { error: "Missing sessionId" },
        { status: 400 }
      );
    }

    const kind = parseKind(req.nextUrl.searchParams.get("kind"));

    const participant = await fetchQuery(
      api.workspaces.getSessionParticipantForRecording,
      { sessionId: sessionId as Id<"sessions"> },
      { token }
    );

    if (!participant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!participant.recordingS3Key) {
      return NextResponse.json(
        { error: "Recording not available for this session" },
        { status: 404 }
      );
    }

    const ttlSeconds = 3600;
    const expiresAt = Date.now() + ttlSeconds * 1000;

    if (kind === "download") {
      const filename = recordingDownloadFilename(participant.callStartedAt);
      const url = await getDownloadUrlWithContentDisposition(
        participant.recordingS3Key,
        filename,
        ttlSeconds
      );
      await reportInfo({
        source: "api/video/recording",
        message: "Signed download URL issued",
        context: {
          sessionId,
          workspaceId: participant.workspaceId,
          role: participant.role,
          kind: "download",
          expiresAt,
          userId: clerkAuth.userId,
        },
      });
      return withNoStore(
        NextResponse.json({ url, expiresAt, filename })
      );
    }

    const url = await getStreamUrl(
      participant.recordingS3Key,
      "video/mp4",
      ttlSeconds
    );
    await reportInfo({
      source: "api/video/recording",
      message: "Signed stream URL issued",
      context: {
        sessionId,
        workspaceId: participant.workspaceId,
        role: participant.role,
        kind: "stream",
        expiresAt,
        userId: clerkAuth.userId,
      },
    });
    return withNoStore(
      NextResponse.json({ url, expiresAt })
    );
  } catch (error) {
    await reportError({
      source: "api/video/recording",
      error,
      message: "Unexpected error in GET /api/video/recording/[sessionId]",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function parseKind(raw: string | null): "stream" | "download" {
  return raw === "download" ? "download" : "stream";
}

function withNoStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

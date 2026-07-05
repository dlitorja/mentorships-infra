import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  createMeetingToken,
  DailyApiError,
  DAILY_MAX_RECORDING_SECONDS,
} from "@/lib/daily";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomName: string }> }
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

    const { roomName } = await params;
    if (!roomName || roomName.length === 0) {
      return NextResponse.json(
        { error: "Missing roomName" },
        { status: 400 }
      );
    }

    const roleResult = await fetchQuery(
      api.sessions.getSessionByVideoRoomName,
      { videoRoomName: roomName },
      { token }
    );

    if (!roleResult) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userName = resolveUserName(clerkAuth.sessionClaims, clerkAuth.userId);

    const { token: meetingToken } = await createMeetingToken({
      roomName,
      userId: clerkAuth.userId,
      userName,
      isOwner: roleResult.role === "owner",
      ttlSeconds: DAILY_MAX_RECORDING_SECONDS,
    });

    return NextResponse.json({ token: meetingToken });
  } catch (error) {
    if (error instanceof DailyApiError) {
      await reportError({
        source: "api/video/token",
        error,
        message: "Daily.co create-meeting-token failed",
        level: "error",
        context: { statusCode: error.statusCode, errorType: error.errorType },
      });
      return NextResponse.json(
        {
          error: "Failed to create meeting token",
          details: error.info ?? error.message,
        },
        { status: 502 }
      );
    }
    await reportError({
      source: "api/video/token",
      error,
      message: "Unexpected error in GET /api/video/token/[roomName]",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Pulls a display name out of the Clerk session claims. Falls back to
 * the bare Clerk user id if no name fields are present (defensive — the
 * token still works, Daily just shows a less friendly label).
 */
function resolveUserName(sessionClaims: unknown, fallbackUserId: string): string {
  if (!sessionClaims || typeof sessionClaims !== "object") {
    return fallbackUserId;
  }
  const claims = sessionClaims as Record<string, unknown>;
  const firstName = typeof claims.firstName === "string" ? claims.firstName : "";
  const lastName = typeof claims.lastName === "string" ? claims.lastName : "";
  const full = `${firstName} ${lastName}`.trim();
  if (full.length > 0) return full;
  if (typeof claims.username === "string" && claims.username.length > 0) {
    return claims.username;
  }
  return fallbackUserId;
}

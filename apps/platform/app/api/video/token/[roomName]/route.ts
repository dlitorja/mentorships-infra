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

    const [roleResult, userProfile] = await Promise.all([
      fetchQuery(
        api.sessions.getSessionByVideoRoomName,
        { videoRoomName: roomName },
        { token }
      ),
      fetchQuery(api.users.getCurrentUser, {}, { token }),
    ]);

    if (!roleResult) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userName = resolveUserName(userProfile, roleResult.role);

    // Only auto-start cloud recording when we have a positive snapshot that
    // the room was created with recording enabled. Legacy sessions created
    // before the roomRecordingEnabled snapshot field may be undefined, so we
    // treat those as *not* configured for auto-recording rather than guessing
    // and potentially starting a recording for a non-consented room.
    const shouldStartCloudRecording =
      roleResult.role === "owner" &&
      roleResult.recordingConsent === true &&
      roleResult.roomRecordingEnabled === true;

    const { token: meetingToken } = await createMeetingToken({
      roomName,
      userId: clerkAuth.userId,
      userName,
      isOwner: roleResult.role === "owner",
      ttlSeconds: DAILY_MAX_RECORDING_SECONDS,
      startCloudRecording: shouldStartCloudRecording,
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

function resolveUserName(
  userProfile: { firstName?: string; lastName?: string; email: string } | null,
  role: "owner" | "participant"
): string {
  const fullName = [userProfile?.firstName, userProfile?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || userProfile?.email || (role === "owner" ? "Instructor" : "Student");
}

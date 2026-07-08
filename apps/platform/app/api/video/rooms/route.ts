import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { ConvexError } from "convex/values";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DailyApiError,
  resolveDailyRoom,
  videoRoomNameForSession,
} from "@/lib/daily";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

type VideoConvexErrorCode =
  | "VIDEO_ROOM_NAME_CONFLICT"
  | "VIDEO_ROOM_NAME_TAKEN";

function getVideoRoomsConvexErrorCode(
  error: unknown
): VideoConvexErrorCode | null {
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null
  ) {
    const code = (error.data as { code?: unknown }).code;
    if (code === "VIDEO_ROOM_NAME_CONFLICT") return code;
    // PR #7: widen-phase uniqueness guard. Triggered when another
    // session already owns the room name we picked. Caller should
    // resolve a fresh name and retry. The route's request lifecycle
    // doesn't include a built-in retry, so the caller (UI) sees a
    // 409 + this message and is expected to retry the POST.
    if (code === "VIDEO_ROOM_NAME_TAKEN") return code;
  }
  return null;
}

const createRoomSchema = z.object({
  sessionId: convexIdSchema,
});

export async function POST(req: NextRequest): Promise<NextResponse> {
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

    const body = await req.json();
    const parsed = createRoomSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { sessionId } = parsed.data;
    const sessionIdTyped = sessionId as Id<"sessions">;

    const existing = await fetchQuery(
      api.sessions.getSessionById,
      { id: sessionIdTyped },
      { token }
    );

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (existing.callEndedAt !== undefined) {
      return NextResponse.json(
        { error: "Call has already ended; cannot create a new room" },
        { status: 409 }
      );
    }

    const instructor = await fetchQuery(
      api.instructors.getInstructorByUserId,
      { userId: clerkAuth.userId },
      { token }
    );

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 403 }
      );
    }

    if (existing.instructorId !== instructor._id) {
      return NextResponse.json(
        { error: "Forbidden: only the session's instructor can create a room" },
        { status: 403 }
      );
    }

    const expectedRoomName = videoRoomNameForSession(sessionIdTyped);
    if (
      existing.videoRoomName === expectedRoomName &&
      existing.videoRoomUrl !== undefined &&
      existing.videoRoomUrl.length > 0
    ) {
      return NextResponse.json({
        roomName: existing.videoRoomName,
        roomUrl: existing.videoRoomUrl,
      });
    }

    const { roomName, roomUrl } = await resolveDailyRoom(sessionIdTyped, {
      recordingEnabled: existing.recordingConsent,
    });

    await fetchMutation(
      api.sessions.setVideoRoom,
      {
        sessionId: sessionIdTyped,
        videoRoomName: roomName,
        videoRoomUrl: roomUrl,
        roomRecordingEnabled: existing.recordingConsent,
      },
      { token }
    );

    return NextResponse.json({ roomName, roomUrl });
  } catch (error) {
    const conflictCode = getVideoRoomsConvexErrorCode(error);
    if (conflictCode === "VIDEO_ROOM_NAME_CONFLICT") {
      await reportError({
        source: "api/video/rooms",
        error,
        message: "Session has a conflicting videoRoomName",
        level: "warn",
      });
      return NextResponse.json(
        {
          error:
            "Session already has a different videoRoomName; cannot create a new room",
        },
        { status: 409 }
      );
    }
    if (conflictCode === "VIDEO_ROOM_NAME_TAKEN") {
      await reportError({
        source: "api/video/rooms",
        error,
        message: "videoRoomName already taken by another session; retry",
        level: "warn",
      });
      return NextResponse.json(
        {
          error:
            "Room name already in use by another session; retry with a fresh request",
        },
        { status: 409 }
      );
    }
    if (error instanceof DailyApiError) {
      const message =
        error.statusCode === 409
          ? "Room already exists for this session"
          : "Failed to create video room";
      await reportError({
        source: "api/video/rooms",
        error,
        message: "Daily.co create-room failed",
        level: "error",
        context: { statusCode: error.statusCode, errorType: error.errorType },
      });
      return NextResponse.json(
        {
          error: message,
          details: error.info ?? error.message,
        },
        { status: error.statusCode === 409 ? 409 : 502 }
      );
    }
    await reportError({
      source: "api/video/rooms",
      error,
      message: "Unexpected error in POST /api/video/rooms",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

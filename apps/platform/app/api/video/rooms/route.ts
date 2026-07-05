import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  createDailyRoom,
  DailyApiError,
  getDailyRoom,
  videoRoomNameForSession,
} from "@/lib/daily";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

const createRoomSchema = z.object({
  sessionId: z.string().min(1),
});

async function resolveDailyRoom(
  sessionId: Id<"sessions">
): Promise<{ roomName: string; roomUrl: string }> {
  const roomName = videoRoomNameForSession(sessionId);
  try {
    return await createDailyRoom(sessionId, { recordingEnabled: true });
  } catch (error) {
    if (error instanceof DailyApiError && error.statusCode === 409) {
      const existing = await getDailyRoom(roomName);
      if (existing !== null) {
        return existing;
      }
    }
    throw error;
  }
}

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

    const { roomName, roomUrl } = await resolveDailyRoom(sessionIdTyped);

    await fetchMutation(
      api.sessions.setVideoRoom,
      {
        sessionId: sessionIdTyped,
        videoRoomName: roomName,
        videoRoomUrl: roomUrl,
      },
      { token }
    );

    return NextResponse.json({ roomName, roomUrl });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error.issues },
        { status: 400 }
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

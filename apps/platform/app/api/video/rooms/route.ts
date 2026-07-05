import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  createDailyRoom,
  DailyApiError,
} from "@/lib/daily";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

const createRoomSchema = z.object({
  sessionId: z.string().min(1),
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

    const existing = await fetchQuery(
      api.sessions.getSessionById,
      { id: sessionId as Id<"sessions"> },
      { token }
    );

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (existing.videoRoomName && existing.videoRoomUrl) {
      return NextResponse.json({
        roomName: existing.videoRoomName,
        roomUrl: existing.videoRoomUrl,
      });
    }

    const { roomName, roomUrl } = await createDailyRoom(
      sessionId as Id<"sessions">
    );

    try {
      await fetchMutation(
        api.sessions.setVideoRoom,
        { sessionId: sessionId as Id<"sessions">, videoRoomName: roomName, videoRoomUrl: roomUrl },
        { token }
      );
    } catch (mutationError) {
      const message =
        mutationError instanceof Error ? mutationError.message : String(mutationError);
      if (message.includes("Unauthorized")) {
        await reportError({
          source: "api/video/rooms",
          error: mutationError,
          message: "Convex auth check failed while saving room",
          level: "warn",
          context: { sessionId },
        });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (message.includes("Forbidden")) {
        await reportError({
          source: "api/video/rooms",
          error: mutationError,
          message: "Instructor-only check failed",
          level: "warn",
          context: { sessionId },
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw mutationError;
    }

    return NextResponse.json({ roomName, roomUrl });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof DailyApiError) {
      await reportError({
        source: "api/video/rooms",
        error,
        message: "Daily.co create-room failed",
        level: "error",
        context: { statusCode: error.statusCode, errorType: error.errorType },
      });
      return NextResponse.json(
        {
          error: "Failed to create video room",
          details: error.info ?? error.message,
        },
        { status: 502 }
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

import { NextRequest, NextResponse } from "next/server";
import { ConvexError } from "convex/values";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

type VideoConvexErrorCode =
  | "VIDEO_UNAUTHORIZED"
  | "VIDEO_FORBIDDEN_NOT_PARTICIPANT"
  | "VIDEO_SESSION_NOT_FOUND";

function getVideoConvexErrorCode(error: unknown): VideoConvexErrorCode | null {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null) {
    const code = (error.data as { code?: unknown }).code;
    if (
      code === "VIDEO_UNAUTHORIZED" ||
      code === "VIDEO_FORBIDDEN_NOT_PARTICIPANT" ||
      code === "VIDEO_SESSION_NOT_FOUND"
    ) {
      return code;
    }
  }
  return null;
}

export async function POST(
  _req: NextRequest,
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

    try {
      const callEndedAt = await fetchMutation(
        api.sessions.endCall,
        { sessionId: sessionId as Id<"sessions"> },
        { token }
      );
      return NextResponse.json({ success: true, callEndedAt });
    } catch (mutationError) {
      const code = getVideoConvexErrorCode(mutationError);
      if (code === "VIDEO_UNAUTHORIZED") {
        await reportError({
          source: "api/video/end",
          error: mutationError,
          message: "Convex auth check failed while ending call",
          level: "warn",
          context: { sessionId },
        });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (code === "VIDEO_FORBIDDEN_NOT_PARTICIPANT") {
        await reportError({
          source: "api/video/end",
          error: mutationError,
          message: "Non-participant tried to end call",
          level: "warn",
          context: { sessionId },
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (code === "VIDEO_SESSION_NOT_FOUND") {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }
      throw mutationError;
    }
  } catch (error) {
    await reportError({
      source: "api/video/end",
      error,
      message: "Unexpected error in POST /api/video/end/[sessionId]",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

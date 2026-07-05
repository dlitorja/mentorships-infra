import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

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
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError);
      if (message.includes("Unauthorized")) {
        await reportError({
          source: "api/video/end",
          error: mutationError,
          message: "Convex auth check failed while ending call",
          level: "warn",
          context: { sessionId },
        });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (message.includes("Forbidden")) {
        await reportError({
          source: "api/video/end",
          error: mutationError,
          message: "Non-participant tried to end call",
          level: "warn",
          context: { sessionId },
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (message.includes("Session not found")) {
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

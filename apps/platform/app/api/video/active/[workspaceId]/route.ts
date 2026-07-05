import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
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

    const { workspaceId } = await params;
    if (!workspaceId || workspaceId.length === 0) {
      return NextResponse.json(
        { error: "Missing workspaceId" },
        { status: 400 }
      );
    }

    const active = await fetchQuery(
      api.sessions.getActiveSessionForWorkspace,
      { workspaceId: workspaceId as Id<"workspaces"> },
      { token }
    );

    if (!active) {
      return NextResponse.json({ active: false });
    }

    return NextResponse.json({
      active: true,
      sessionId: active.sessionId,
      roomName: active.roomName,
      roomUrl: active.roomUrl,
      startedAt: active.startedAt,
    });
  } catch (error) {
    await reportError({
      source: "api/video/active",
      error,
      message: "Unexpected error in GET /api/video/active/[workspaceId]",
      level: "error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

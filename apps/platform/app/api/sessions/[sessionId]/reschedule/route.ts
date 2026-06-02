import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * POST /api/sessions/[sessionId]/reschedule
 * Reschedule a session
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();
    const { sessionId } = await params;

    const body = await req.json();
    const { newScheduledAt } = body;

    if (!newScheduledAt) {
      return NextResponse.json(
        { error: "newScheduledAt is required" },
        { status: 400 }
      );
    }

    const newScheduledAtMs = new Date(newScheduledAt).getTime();
    if (isNaN(newScheduledAtMs)) {
      return NextResponse.json(
        { error: "Invalid date format for newScheduledAt" },
        { status: 400 }
      );
    }

    await convex.mutation(api.sessions.rescheduleSession, {
      id: sessionId as any,
      newScheduledAt: newScheduledAtMs,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Forbidden" }, { status: 403 });
    }

    console.error("Error rescheduling session:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reschedule session" },
      { status: 500 }
    );
  }
}
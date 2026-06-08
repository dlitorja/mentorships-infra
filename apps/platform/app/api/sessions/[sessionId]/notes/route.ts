import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * PATCH /api/sessions/[sessionId]/notes
 * Update session notes
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { id: userId } = await requireRoleForApi("instructor");
    const convex = getConvexClient();
    const { sessionId } = await params;

    const body = await req.json();
    const { notes } = body;

    if (typeof notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 }
      );
    }

    const session = await convex.query(api.sessions.getSessionById, {
      id: sessionId as Id<"sessions">,
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const currentInstructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId,
    });
    if (!currentInstructor || currentInstructor._id !== session.instructorId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await convex.mutation(api.sessions.updateSessionNotes, {
      id: sessionId as Id<"sessions">,
      notes,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Forbidden" }, { status: 403 });
    }

    console.error("Error updating session notes:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session notes" },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * POST /api/instructor/students/[studentId]/sessions
 * Book a new session for a student
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();
    const { studentId } = await params;

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { scheduledAt, sessionPackId, notes } = body;

    if (!scheduledAt || !sessionPackId) {
      return NextResponse.json(
        { error: "scheduledAt and sessionPackId are required" },
        { status: 400 }
      );
    }

    const scheduledAtMs = new Date(scheduledAt).getTime();
    if (isNaN(scheduledAtMs)) {
      return NextResponse.json(
        { error: "Invalid date format for scheduledAt" },
        { status: 400 }
      );
    }

    const sessionPack = await convex.query(api.sessionPacks.getSessionPackById, {
      id: sessionPackId as any,
    });

    if (!sessionPack) {
      return NextResponse.json(
        { error: "Session pack not found" },
        { status: 404 }
      );
    }

    if (sessionPack.remainingSessions <= 0) {
      return NextResponse.json(
        { error: "No remaining sessions in this pack. Student needs to renew." },
        { status: 400 }
      );
    }

    if (sessionPack.status !== "active") {
      return NextResponse.json(
        { error: `Cannot book session: pack status is ${sessionPack.status}` },
        { status: 400 }
      );
    }

    const sessionId = await convex.mutation(api.sessions.createSession, {
      instructorId: instructor._id,
      studentId: studentId,
      sessionPackId: sessionPackId as any,
      scheduledAt: scheduledAtMs,
      notes: notes || undefined,
    });

    return NextResponse.json({ id: sessionId, success: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create session" },
      { status: 500 }
    );
  }
}
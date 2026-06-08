import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { tasks } from "@trigger.dev/sdk";
import type { sessionRescheduledNotifications } from "@/trigger/session-change-notifications";

/**
 * POST /api/sessions/[sessionId]/reschedule
 * Reschedule a session
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { id: userId } = await requireRoleForApi("instructor");
    const convex = getConvexClient();
    const { sessionId } = await params;

    const body = await req.json();
    const { newScheduledAt, suppressNotifications } = body;

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

    if (newScheduledAtMs <= Date.now()) {
      return NextResponse.json(
        { error: "newScheduledAt must be in the future" },
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

    const oldScheduledAtUtc = session.scheduledAt;

    const [instructor, studentUser] = await Promise.all([
      convex.query(api.instructors.getInstructorById, {
        id: session.instructorId,
      }),
      convex.query(api.users.getUserByUserId, {
        userId: session.studentId,
      }),
    ]);

    await convex.mutation(api.sessions.rescheduleSession, {
      id: sessionId as Id<"sessions">,
      newScheduledAt: newScheduledAtMs,
    });

    if (!suppressNotifications && studentUser?.email) {
      try {
        await tasks.trigger<typeof sessionRescheduledNotifications>("session-rescheduled-notifications", {
          sessionId,
          studentEmail: studentUser.email,
          studentName: [studentUser.firstName, studentUser.lastName].filter(Boolean).join(" ") || studentUser.email,
          instructorName: instructor?.name || "Instructor",
          oldScheduledAtUtc,
          newScheduledAtUtc: newScheduledAtMs,
          studentTimeZone: studentUser.timeZone || null,
        });
      } catch (e) {
        console.error("Failed to trigger session-rescheduled-notifications task:", e);
      }
    }

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
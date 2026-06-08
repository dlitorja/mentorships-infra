import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { tasks } from "@trigger.dev/sdk";
import type { sessionCanceledNotifications } from "@/trigger/session-change-notifications";

/**
 * POST /api/sessions/[sessionId]/cancel
 * Cancel a session
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
    const { reason, suppressNotifications } = body;

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

    const [instructor, studentUser] = await Promise.all([
      convex.query(api.instructors.getInstructorById, {
        id: session.instructorId,
      }),
      convex.query(api.users.getUserByUserId, {
        userId: session.studentId,
      }),
    ]);

    await convex.mutation(api.sessions.cancelSession, {
      id: sessionId as Id<"sessions">,
      reason: reason || undefined,
    });

    if (!suppressNotifications && studentUser?.email) {
      try {
        await tasks.trigger<typeof sessionCanceledNotifications>("session-canceled-notifications", {
          sessionId,
          studentEmail: studentUser.email,
          studentName: [studentUser.firstName, studentUser.lastName].filter(Boolean).join(" ") || studentUser.email,
          instructorName: instructor?.name || "Instructor",
          scheduledAtUtc: session.scheduledAt,
          reason,
          studentTimeZone: studentUser.timeZone || null,
        });
      } catch (e) {
        console.error("Failed to trigger session-canceled-notifications task:", e);
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

    console.error("Error canceling session:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel session" },
      { status: 500 }
    );
  }
}
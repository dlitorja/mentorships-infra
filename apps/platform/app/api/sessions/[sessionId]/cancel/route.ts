import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
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
    const { id: userId, role } = await requireRoleForApi("instructor");
    // This route is for the session's instructor only; admins must use admin
    // session management endpoints if they need to act on other instructors.
    if (role !== "instructor") {
      return NextResponse.json({ error: "Instructor role required" }, { status: 403 });
    }
    const convex = await getAuthenticatedConvexClient();
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
      convex.query(api.users.getUserByClerkIdPublic, {
        userId: session.studentId,
        sessionId: session._id,
      }),
    ]);

    await convex.mutation(api.sessions.cancelSession, {
      id: session._id,
      reason: reason || undefined,
    });

    if (!suppressNotifications && studentUser?.email) {
      try {
        await tasks.trigger<typeof sessionCanceledNotifications>("session-canceled-notifications", {
          sessionId: session._id,
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
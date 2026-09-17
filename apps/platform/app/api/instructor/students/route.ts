import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * GET /api/instructor/students
 * Get all students for the authenticated instructor
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = await getAuthenticatedConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      // Without `getInstructorByUserId` finding the instructor by userId,
      // we cannot tell whether the caller has no instructor record at all
      // or is silently in the "Clerk userId got rotated" reconciliation
      // gap (`linkClerkUserToInstructor` refuses to overwrite a
      // Clerk-shaped userId, and `getInstructorByUserId` returns null).
      //
      // Call the dedicated status query to disambiguate and return a
      // actionable 409 instead of a bare 404. The instructor sees a
      // specific reason + admin contact instead of "Instructor profile
      // not found", which previously blocked debugging.
      const status = await convex.query(
        api.instructors.getInstructorLinkingStatusForCurrentUser,
        {}
      );
      if (status.status === "needs_reconciliation") {
        console.warn(
          `[instructor/students] reconciliation needed: clerkUser=${user.id} existingInstructorClerkUser=${status.existingClerkUserId} instructorId=${status.instructorId}`,
        );
        return NextResponse.json(
          {
            error:
              "Instructor account is linked to a different sign-in. Contact support to relink.",
            code: "instructor_linking_needs_reconciliation",
            instructorId: status.instructorId,
            email: status.email,
            existingClerkUserId: status.existingClerkUserId,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Instructor profile not found", code: "instructor_profile_not_found" },
        { status: 404 }
      );
    }

    const students = await convex.query(api.instructors.getInstructorStudentsWithSessionInfo, {
      instructorId: instructor._id,
    }) as any[];

    return NextResponse.json({
      items: students.map((m: any) => ({
        userId: m.userId,
        email: m.email,
        sessionPackId: m.sessionPackId,
        totalSessions: m.totalSessions,
        remainingSessions: m.remainingSessions,
        expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : null,
        status: m.status,
        lastSessionCompletedAt: m.lastSessionCompletedAt ? new Date(m.lastSessionCompletedAt).toISOString() : null,
        completedSessionCount: m.completedSessionCount,
        workspaceId: m.workspaceId ?? null,
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error fetching instructor students:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch students" },
      { status: 500 }
    );
  }
}
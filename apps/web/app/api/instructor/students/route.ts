import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * GET /api/instructor/students
 * Get all students for the authenticated instructor
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const students = await convex.query(api.instructors.getInstructorStudentsWithSessionInfo, {
      instructorId: instructor._id,
    });

    const items = (Array.isArray(students) ? students : []).map((m: any) => ({
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
    }));

    return NextResponse.json({ items });
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

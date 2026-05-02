import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * GET /api/instructor/mentees
 * Get all mentees for the authenticated instructor
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Mentor profile not found" },
        { status: 404 }
      );
    }

    const mentees = await convex.query(api.instructors.getMentorMenteesWithSessionInfo, {
      mentorId: instructor._id,
    });

    return NextResponse.json({
      items: mentees.map((m) => ({
        userId: m.userId,
        email: m.email,
        sessionPackId: m.sessionPackId,
        totalSessions: m.totalSessions,
        remainingSessions: m.remainingSessions,
        expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : null,
        status: m.status,
        lastSessionCompletedAt: m.lastSessionCompletedAt ? new Date(m.lastSessionCompletedAt).toISOString() : null,
        completedSessionCount: m.completedSessionCount,
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
    }

    console.error("Error fetching instructor mentees:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch mentees" },
      { status: 500 }
    );
  }
}
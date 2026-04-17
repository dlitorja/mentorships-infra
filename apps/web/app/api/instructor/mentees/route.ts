import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getMentorMenteesWithSessionInfo,
  getMentorByUserId,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";

/**
 * GET /api/instructor/mentees
 * Get all mentees for the authenticated instructor
 */
export async function GET(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const user = await requireRoleForApi("mentor");

    const mentor = await getMentorByUserId(user.id);
    if (!mentor) {
      return NextResponse.json(
        { error: "Mentor profile not found" },
        { status: 404 }
      );
    }

    const mentees = await getMentorMenteesWithSessionInfo(mentor.id);

    return NextResponse.json({
      items: mentees.map((m) => ({
        userId: m.userId,
        email: m.email,
        sessionPackId: m.sessionPackId,
        totalSessions: Number(m.totalSessions),
        remainingSessions: Number(m.remainingSessions),
        expiresAt: m.expiresAt?.toISOString() || null,
        status: m.status,
        lastSessionCompletedAt: m.lastSessionCompletedAt?.toISOString() || null,
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

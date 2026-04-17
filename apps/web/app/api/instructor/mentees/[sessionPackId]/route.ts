import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getMentorByUserId,
  getSessionPackById,
  addSessionsToPack,
  removeSessionsFromPack,
  isUnauthorizedError,
  isForbiddenError,
  eq,
  db,
  sessionPacks,
} from "@mentorships/db";

const updateSessionCountSchema = z.object({
  action: z.enum(["increment", "decrement", "set"]),
  amount: z.number().int().min(1).default(1),
});

/**
 * PATCH /api/instructor/mentees/[sessionPackId]
 * Update session count for a mentee's session pack
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionPackId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const user = await requireRoleForApi("mentor");

    const { sessionPackId } = await params;

    const mentor = await getMentorByUserId(user.id);
    if (!mentor) {
      return NextResponse.json(
        { error: "Mentor profile not found" },
        { status: 404 }
      );
    }

    const sessionPack = await getSessionPackById(sessionPackId);
    if (!sessionPack) {
      return NextResponse.json(
        { error: "Session pack not found" },
        { status: 404 }
      );
    }

    if (sessionPack.mentorId !== mentor.id) {
      return NextResponse.json(
        { error: "You do not have permission to modify this session pack" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const validationResult = updateSessionCountSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { action, amount } = validationResult.data;

    let updatedPack = sessionPack;
    if (action === "increment") {
      updatedPack = await addSessionsToPack(sessionPackId, amount);
    } else if (action === "decrement") {
      updatedPack = await removeSessionsFromPack(sessionPackId, amount);
    } else if (action === "set") {
      const currentRemaining = Number(sessionPack.remainingSessions);
      const diff = amount - currentRemaining;
      
      if (diff > 0) {
        updatedPack = await addSessionsToPack(sessionPackId, diff);
      } else if (diff < 0) {
        updatedPack = await removeSessionsFromPack(sessionPackId, Math.abs(diff));
      }
    }

    if (!updatedPack) {
      return NextResponse.json(
        { error: "Failed to update session pack" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sessionPack: {
        id: updatedPack.id,
        totalSessions: Number(updatedPack.totalSessions),
        remainingSessions: Number(updatedPack.remainingSessions),
        status: updatedPack.status,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
    }

    console.error("Error updating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session count" },
      { status: 500 }
    );
  }
}

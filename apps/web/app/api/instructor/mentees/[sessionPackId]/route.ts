import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

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
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const { sessionPackId } = await params;

    const mentor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!mentor) {
      return NextResponse.json(
        { error: "Mentor profile not found" },
        { status: 404 }
      );
    }

    const sessionPack = await convex.query(api.sessionPacks.getSessionPackById, {
      id: sessionPackId as Id<"sessionPacks">,
    });

    if (!sessionPack) {
      return NextResponse.json(
        { error: "Session pack not found" },
        { status: 404 }
      );
    }

    if (sessionPack.mentorId !== mentor._id) {
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

    let updatedPack: typeof sessionPack | null = sessionPack;
    if (action === "increment") {
      updatedPack = await convex.mutation(api.sessionPacks.addSessionsToPack, {
        id: sessionPackId as Id<"sessionPacks">,
        amount,
      });
    } else if (action === "decrement") {
      updatedPack = await convex.mutation(api.sessionPacks.removeSessionsFromPack, {
        id: sessionPackId as Id<"sessionPacks">,
        amount,
      });
    } else if (action === "set") {
      updatedPack = await convex.mutation(api.sessionPacks.setRemainingSessions, {
        id: sessionPackId as Id<"sessionPacks">,
        amount,
      });
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
        id: updatedPack._id,
        totalSessions: updatedPack.totalSessions,
        remainingSessions: updatedPack.remainingSessions,
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
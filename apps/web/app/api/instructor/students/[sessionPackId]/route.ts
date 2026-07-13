import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { auth } from "@clerk/nextjs/server";

const sessionPackIdSchema = z.string().min(1, "Session pack ID is required");
const updateSessionCountSchema = z.object({
  action: z.enum(["increment", "decrement", "set"]),
  amount: z.number().int().min(1).default(1),
});

/**
 * PATCH /api/instructor/students/[sessionPackId]
 * Update session count for a student's session pack
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionPackId: string }> }
) {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const rawParams = await params;
    const rawSessionPackId = sessionPackIdSchema.parse(rawParams.sessionPackId);
    const sessionPackId = rawSessionPackId as Id<"sessionPacks">;

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const sessionPack = await convex.query(api.sessionPacks.getSessionPackById, {
      id: sessionPackId,
    });

    if (!sessionPack) {
      return NextResponse.json(
        { error: "Session pack not found" },
        { status: 404 }
      );
    }

    if (sessionPack.instructorId !== instructor._id) {
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
        id: sessionPackId,
        amount,
      });
    } else if (action === "decrement") {
      updatedPack = await convex.mutation(api.sessionPacks.removeSessionsFromPack, {
        id: sessionPackId,
        amount,
      });
    } else if (action === "set") {
      updatedPack = await convex.mutation(api.sessionPacks.setRemainingSessions, {
        id: sessionPackId,
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error updating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session count" },
      { status: 500 }
    );
  }
}
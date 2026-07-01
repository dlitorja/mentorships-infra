import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

const sessionPackIdSchema = z.string().min(1, "Session pack ID is required");
const sessionPackErrorSchema = z.object({
  code: z.literal("SESSION_PACK_UNDO_CONFLICT"),
  message: z.string(),
});
const updateSessionCountSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("increment"), amount: z.number().int().min(1).default(1) }),
  z.object({ action: z.literal("decrement"), amount: z.number().int().min(1).default(1) }),
  z.object({ action: z.literal("set"), amount: z.number().int().min(0) }),
  z
    .object({
      action: z.literal("restore"),
      totalSessions: z.number().int().min(0),
      remainingSessions: z.number().int().min(0),
      expectedTotalSessions: z.number().int().min(0),
      expectedRemainingSessions: z.number().int().min(0),
    })
    .refine((data) => data.remainingSessions <= data.totalSessions, {
      message: "remainingSessions must be less than or equal to totalSessions",
      path: ["remainingSessions"],
    })
    .refine((data) => data.expectedRemainingSessions <= data.expectedTotalSessions, {
      message: "expectedRemainingSessions must be less than or equal to expectedTotalSessions",
      path: ["expectedRemainingSessions"],
    }),
]);

function getSessionPackError(error: unknown): z.infer<typeof sessionPackErrorSchema> | null {
  if (!(error instanceof Error)) return null;

  try {
    return sessionPackErrorSchema.parse(JSON.parse(error.message));
  } catch {
    return null;
  }
}

/**
 * PATCH /api/instructor/session-packs/[sessionPackId]
 * Update session count for a student's session pack
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionPackId: string }> }
) {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();

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

    if (sessionPack.deletedAt) {
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

    const { action } = validationResult.data;

    let updatedPack: typeof sessionPack | null = sessionPack;
    if (action === "increment") {
      updatedPack = await convex.mutation(api.sessionPacks.addSessionsToPack, {
        id: sessionPackId,
        amount: validationResult.data.amount,
      });
    } else if (action === "decrement") {
      updatedPack = await convex.mutation(api.sessionPacks.removeSessionsFromPack, {
        id: sessionPackId,
        amount: validationResult.data.amount,
      });
    } else if (action === "set") {
      updatedPack = await convex.mutation(api.sessionPacks.setRemainingSessions, {
        id: sessionPackId,
        amount: validationResult.data.amount,
      });
    } else if (action === "restore") {
      updatedPack = await convex.mutation(api.sessionPacks.restoreSessionCounts, {
        id: sessionPackId,
        totalSessions: validationResult.data.totalSessions,
        remainingSessions: validationResult.data.remainingSessions,
        expectedTotalSessions: validationResult.data.expectedTotalSessions,
        expectedRemainingSessions: validationResult.data.expectedRemainingSessions,
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

    const sessionPackError = getSessionPackError(error);
    if (sessionPackError?.code === "SESSION_PACK_UNDO_CONFLICT") {
      return NextResponse.json({ error: sessionPackError.message }, { status: 409 });
    }

    console.error("Error updating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session count" },
      { status: 500 }
    );
  }
}

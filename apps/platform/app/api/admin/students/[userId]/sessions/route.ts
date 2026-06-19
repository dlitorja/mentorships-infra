import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";

const addSessionsSchema = z.object({
  instructorId: z.string().min(1, "instructorId is required"),
  totalSessions: z.number().int().min(1, "totalSessions must be at least 1"),
  expiresAt: z.string().optional(),
});

/**
 * POST /api/admin/students/[userId]/sessions
 * Add session pack to a student without payment flow (admin-created).
 * Body: { instructorId: string, totalSessions: number, expiresAt?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireRoleForApi("admin");

    const { userId } = await params;

    const body = await req.json();
    const parsed = addSessionsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { instructorId, totalSessions, expiresAt } = parsed.data;

    let expiresAtMs: number | undefined;
    if (expiresAt) {
      const expiresDate = new Date(expiresAt);
      if (isNaN(expiresDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid expiresAt date format" },
          { status: 400 }
        );
      }
      expiresAtMs = expiresDate.getTime();
    }

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const sessionPack = await convex.mutation(
      api.sessionPacks.createAdminSessionPack,
      {
        userId,
        instructorId: instructorId as any,
        totalSessions,
        expiresAt: expiresAtMs,
      }
    );

    if (!sessionPack) {
      return NextResponse.json({ error: "Failed to create session pack" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      sessionPack: {
        id: sessionPack._id,
        userId: sessionPack.userId,
        instructorId: sessionPack.instructorId,
        totalSessions: sessionPack.totalSessions,
        remainingSessions: sessionPack.remainingSessions,
        status: sessionPack.status,
        purchasedAt: new Date(sessionPack.purchasedAt).toISOString(),
        expiresAt: sessionPack.expiresAt ? new Date(sessionPack.expiresAt).toISOString() : null,
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Forbidden" }, { status: 403 });
    }

    console.error("Error adding sessions to student:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add sessions" },
      { status: 500 }
    );
  }
}
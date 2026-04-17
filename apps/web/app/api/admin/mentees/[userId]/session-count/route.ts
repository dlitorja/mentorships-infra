import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSessionCountsForMentee,
  createSessionCount,
  updateSessionCount,
  adjustSessionCount,
  deleteSessionCount,
  upsertSessionCount,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";

const createSchema = z.object({
  instructorId: z.string().uuid("Invalid instructor ID"),
  sessionCount: z.number().int("Must be an integer"),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  sessionCount: z.number().int("Must be an integer"),
  notes: z.string().optional(),
});

const adjustSchema = z.object({
  adjustment: z.number().int("Must be an integer"),
  notes: z.string().optional(),
});

/**
 * GET /api/admin/mentees/[userId]/session-count
 * Get all session counts for a mentee
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { userId } = await params;

    const counts = await getSessionCountsForMentee(userId);

    return NextResponse.json({
      items: counts.map((c) => ({
        id: c.id,
        userId: c.userId,
        instructorId: c.instructorId,
        instructorName: c.instructorName,
        instructorSlug: c.instructorSlug,
        sessionCount: c.sessionCount,
        notes: c.notes,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error fetching session counts:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch session counts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/mentees/[userId]/session-count
 * Create a new session count for a mentee-instructor pair
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { userId } = await params;
    const body = await req.json();
    const validation = createSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { instructorId, sessionCount, notes } = validation.data;

    const result = await upsertSessionCount(userId, instructorId, sessionCount, notes);

    return NextResponse.json({
      id: result.id,
      userId: result.userId,
      instructorId: result.instructorId,
      sessionCount: result.sessionCount,
      notes: result.notes,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error creating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create session count" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/mentees/[userId]/session-count
 * Adjust session count (add/subtract sessions)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { userId } = await params;
    const body = await req.json();

    const { id, adjustment, sessionCount, notes } = body;

    if (adjustment !== undefined) {
      if (typeof adjustment !== "number") {
        return NextResponse.json({ error: "Invalid adjustment value" }, { status: 400 });
      }
      const validation = adjustSchema.safeParse(body);
      if (!validation.success) {
        return NextResponse.json(
          { error: "Invalid request", details: validation.error.issues },
          { status: 400 }
        );
      }

      const result = await adjustSessionCount(id, adjustment, notes);
      if (!result) {
        return NextResponse.json({ error: "Session count not found" }, { status: 404 });
      }

      return NextResponse.json({
        id: result.id,
        userId: result.userId,
        instructorId: result.instructorId,
        sessionCount: result.sessionCount,
        notes: result.notes,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      });
    }

    if (sessionCount !== undefined) {
      const validation = updateSchema.safeParse(body);
      if (!validation.success) {
        return NextResponse.json(
          { error: "Invalid request", details: validation.error.issues },
          { status: 400 }
        );
      }

      const result = await updateSessionCount(id, sessionCount, notes);
      if (!result) {
        return NextResponse.json({ error: "Session count not found" }, { status: 404 });
      }

      return NextResponse.json({
        id: result.id,
        userId: result.userId,
        instructorId: result.instructorId,
        sessionCount: result.sessionCount,
        notes: result.notes,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      });
    }

    return NextResponse.json({ error: "Missing id or sessionCount/adjustment" }, { status: 400 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error updating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session count" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/mentees/[userId]/session-count
 * Delete a session count record
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { userId } = await params;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const deleted = await deleteSessionCount(id);
    if (!deleted) {
      return NextResponse.json({ error: "Session count not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error deleting session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete session count" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

const createSchema = z.object({
  instructorId: z.string(),
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

    const convex = getConvexClient();
    type SessionCountResult = {
      id: string;
      userId: string;
      instructorId: string;
      sessionCount: number;
      notes: string | null;
      createdAt: number;
      updatedAt: number;
      instructorName: string | null;
      instructorSlug: string | null;
    };
    const counts = await convex.query(api.menteeSessionCounts.getSessionCountsForMentee, { userId }) as SessionCountResult[];

    return NextResponse.json({
      items: counts.map((c) => ({
        id: c.id,
        userId: c.userId,
        instructorId: c.instructorId,
        instructorName: c.instructorName,
        instructorSlug: c.instructorSlug,
        sessionCount: c.sessionCount,
        notes: c.notes,
        createdAt: new Date(c.createdAt).toISOString(),
        updatedAt: new Date(c.updatedAt).toISOString(),
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

    const convex = getConvexClient();
    const result = await convex.mutation(api.menteeSessionCounts.upsertSessionCount, {
      userId,
      instructorId: instructorId as Id<"instructors">,
      sessionCount,
      notes,
    });

    return NextResponse.json({
      id: result._id,
      userId: result.userId,
      instructorId: result.instructorId,
      sessionCount: result.sessionCount,
      notes: result.notes ?? null,
      createdAt: new Date(result.createdAt).toISOString(),
      updatedAt: new Date(result.updatedAt).toISOString(),
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

    const { userId: pathUserId } = await params;
    const body = await req.json();

    const { id, adjustment, sessionCount, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const convex = getConvexClient();

    const counts = await convex.query(api.menteeSessionCounts.getSessionCountsForMentee, { userId: pathUserId }) as Array<{ id: string; userId: string }>;
    const record = counts.find((c) => c.id === id);
    if (!record) {
      return NextResponse.json({ error: "Session count not found" }, { status: 404 });
    }
    if (record.userId !== pathUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

      const result = await convex.mutation(api.menteeSessionCounts.adjustSessionCount, {
        id: id as Id<"menteeSessionCounts">,
        adjustment,
        notes,
      });
      if (!result) {
        return NextResponse.json({ error: "Session count not found" }, { status: 404 });
      }

      return NextResponse.json({
        id: result._id,
        userId: result.userId,
        instructorId: result.instructorId,
        sessionCount: result.sessionCount,
        notes: result.notes ?? null,
        createdAt: new Date(result.createdAt).toISOString(),
        updatedAt: new Date(result.updatedAt).toISOString(),
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

      const result = await convex.mutation(api.menteeSessionCounts.updateSessionCount, {
        id: id as Id<"menteeSessionCounts">,
        sessionCount,
        notes,
      });
      if (!result) {
        return NextResponse.json({ error: "Session count not found" }, { status: 404 });
      }

      return NextResponse.json({
        id: result._id,
        userId: result.userId,
        instructorId: result.instructorId,
        sessionCount: result.sessionCount,
        notes: result.notes ?? null,
        createdAt: new Date(result.createdAt).toISOString(),
        updatedAt: new Date(result.updatedAt).toISOString(),
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

    const { userId: pathUserId } = await params;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const convex = getConvexClient();

    const counts = await convex.query(api.menteeSessionCounts.getSessionCountsForMentee, { userId: pathUserId }) as Array<{ id: string; userId: string }>;
    const record = counts.find((c) => c.id === id);
    if (!record) {
      return NextResponse.json({ error: "Session count not found" }, { status: 404 });
    }
    if (record.userId !== pathUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deleted = await convex.mutation(api.menteeSessionCounts.deleteSessionCount, {
      id: id as Id<"menteeSessionCounts">,
    });
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

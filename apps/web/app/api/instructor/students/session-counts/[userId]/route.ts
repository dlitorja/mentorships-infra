import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

const createSchema = z.object({
  sessionCount: z.number().int("Must be an integer").min(0, "Must be >= 0"),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  sessionCount: z.number().int("Must be an integer").min(0, "Must be >= 0"),
  notes: z.string().optional(),
});

const adjustSchema = z.object({
  adjustment: z.number().int("Must be an integer"),
  notes: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const user = await requireRoleForApi("instructor");

    const convex = getConvexClient();
    const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor profile not found" }, { status: 404 });
    }

    const { userId } = await params;

    const counts = await convex.query(api.studentSessionCounts.getSessionCountsForStudent, { userId });
    const count = counts.find((c: any) => c.instructorId === instructor._id);

    if (!count) {
      return NextResponse.json({ error: "Session count not found for this student" }, { status: 404 });
    }

    return NextResponse.json({
      id: count.id,
      userId: count.userId,
      instructorId: count.instructorId,
      sessionCount: count.sessionCount,
      notes: count.notes,
      createdAt: new Date(count.createdAt).toISOString(),
      updatedAt: new Date(count.updatedAt).toISOString(),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error fetching session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch session count" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const user = await requireRoleForApi("instructor");

    const convex = getConvexClient();
    const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor profile not found" }, { status: 404 });
    }

    const { userId } = await params;
    const body = await req.json();
    const validation = createSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { sessionCount, notes } = validation.data;

    // Ownership check: ensure the target user has a session pack with this instructor
    const packs = await convex.query(api.sessionPacks.getUserSessionPacksWithInstructors, {
      userId,
      limit: 1,
      offset: 0,
    });
    const isStudentOfInstructor = Boolean(
      packs?.items?.some((p: any) => p.instructorId === instructor._id)
    );
    if (!isStudentOfInstructor) {
      return NextResponse.json(
        { error: "Forbidden: Only your own students can have session counts" },
        { status: 403 }
      );
    }

    const result = await convex.mutation(api.studentSessionCounts.upsertSessionCount, {
      userId,
      instructorId: instructor._id as Id<"instructors">,
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
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error creating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create session count" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const user = await requireRoleForApi("instructor");

    const convex = getConvexClient();
    const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor profile not found" }, { status: 404 });
    }

    const { userId } = await params;
    const body = await req.json();

    const { id, adjustment, sessionCount, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const counts = await convex.query(api.studentSessionCounts.getSessionCountsForStudent, { userId }) as Array<{ id: string; userId: string; instructorId: string }>;
    const record = counts.find((c) => c.id === id);
    if (!record) {
      return NextResponse.json({ error: "Session count not found" }, { status: 404 });
    }

    if (record.instructorId !== instructor._id) {
      return NextResponse.json({ error: "Forbidden: You can only modify your own student session counts" }, { status: 403 });
    }

    if (adjustment !== undefined && sessionCount !== undefined) {
      return NextResponse.json({ error: "Specify either adjustment or sessionCount, not both" }, { status: 400 });
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

      const result = await convex.mutation(api.studentSessionCounts.adjustSessionCount, {
        id: id as Id<"studentSessionCounts">,
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

      const result = await convex.mutation(api.studentSessionCounts.updateSessionCount, {
        id: id as Id<"studentSessionCounts">,
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
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error updating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session count" },
      { status: 500 }
    );
  }
}

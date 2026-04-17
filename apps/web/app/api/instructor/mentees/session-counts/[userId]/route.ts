import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSessionCountForInstructorMentee,
  getInstructorMenteesWithSessionCounts,
  createSessionCount,
  updateSessionCount,
  adjustSessionCount,
  getMentorByUserId,
  upsertSessionCount,
  isUnauthorizedError,
  isForbiddenError,
  instructors,
  menteeSessionCounts,
  eq,
  db,
} from "@mentorships/db";

const createSchema = z.object({
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const user = await requireRoleForApi("mentor");

    const mentor = await getMentorByUserId(user.id);
    if (!mentor) {
      return NextResponse.json({ error: "Mentor profile not found" }, { status: 404 });
    }

    const instructor = await db
      .select({ id: instructors.id })
      .from(instructors)
      .where(eq(instructors.mentorId, mentor.id))
      .limit(1);

    if (instructor.length === 0) {
      return NextResponse.json({ error: "Instructor profile not found" }, { status: 404 });
    }

    const { userId } = await params;

    const count = await getSessionCountForInstructorMentee(userId, instructor[0].id);

    if (!count) {
      return NextResponse.json({ error: "Session count not found for this mentee" }, { status: 404 });
    }

    return NextResponse.json({
      id: count.id,
      userId: count.userId,
      instructorId: count.instructorId,
      sessionCount: count.sessionCount,
      notes: count.notes,
      createdAt: count.createdAt.toISOString(),
      updatedAt: count.updatedAt.toISOString(),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
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
    const user = await requireRoleForApi("mentor");

    const mentor = await getMentorByUserId(user.id);
    if (!mentor) {
      return NextResponse.json({ error: "Mentor profile not found" }, { status: 404 });
    }

    const instructor = await db
      .select({ id: instructors.id })
      .from(instructors)
      .where(eq(instructors.mentorId, mentor.id))
      .limit(1);

    if (instructor.length === 0) {
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

    const result = await upsertSessionCount(userId, instructor[0].id, sessionCount, notes);

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
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
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
    const user = await requireRoleForApi("mentor");

    const mentor = await getMentorByUserId(user.id);
    if (!mentor) {
      return NextResponse.json({ error: "Mentor profile not found" }, { status: 404 });
    }

    const instructor = await db
      .select({ id: instructors.id })
      .from(instructors)
      .where(eq(instructors.mentorId, mentor.id))
      .limit(1);

    if (instructor.length === 0) {
      return NextResponse.json({ error: "Instructor profile not found" }, { status: 404 });
    }

    const { userId } = await params;
    const body = await req.json();

    const { id, adjustment, sessionCount, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    const existingRecord = await db
      .select()
      .from(menteeSessionCounts)
      .where(eq(menteeSessionCounts.id, id))
      .limit(1);

    if (existingRecord.length === 0) {
      return NextResponse.json({ error: "Session count not found" }, { status: 404 });
    }

    if (existingRecord[0].instructorId !== instructor[0].id) {
      return NextResponse.json({ error: "Forbidden: You can only modify your own mentee session counts" }, { status: 403 });
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
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
    }

    console.error("Error updating session count:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session count" },
      { status: 500 }
    );
  }
}

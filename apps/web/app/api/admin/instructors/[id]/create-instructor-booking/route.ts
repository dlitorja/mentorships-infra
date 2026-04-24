import { NextRequest, NextResponse } from "next/server";
import { db, instructors, mentors, isUnauthorizedError, isForbiddenError, eq } from "@mentorships/db";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { protectWithRateLimit } from "@/lib/ratelimit";

/** Create a mentor booking record for an instructor */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const { id: instructorId } = await params;

    const [instructor] = await db
      .select()
      .from(instructors)
      .where(eq(instructors.id, instructorId))
      .limit(1);

    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    if (instructor.mentorId) {
      return NextResponse.json({ error: "Instructor already has a booking record linked" }, { status: 400 });
    }

    const [createdMentor] = await db
      .insert(mentors)
      .values({
        userId: instructor.userId || "",
        maxActiveStudents: 3,
        oneOnOneInventory: 0,
        groupInventory: 0,
      })
      .returning();

    await db
      .update(instructors)
      .set({ mentorId: createdMentor.id })
      .where(eq(instructors.id, instructorId));

    return NextResponse.json({
      success: true,
      instructorBookingId: createdMentor.id,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error creating instructor booking record:", error);
    return NextResponse.json({ error: "Failed to create instructor booking record" }, { status: 500 });
  }
}
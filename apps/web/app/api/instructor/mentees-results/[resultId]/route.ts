import { NextRequest, NextResponse } from "next/server";
import {
  db,
  menteeResults,
  getInstructorByUserId,
  isUnauthorizedError,
} from "@mentorships/db";
import { eq, and } from "drizzle-orm";

/**
 * DELETE /api/instructor/mentees-results/[resultId]
 * Delete a mentee result (only if it belongs to the current instructor)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ resultId: string }> }
) {
  try {
    const { requireDbUser } = await import("@/lib/auth");
    const user = await requireDbUser();

    const instructor = await getInstructorByUserId(user.id);
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const { resultId } = await params;

    // Check if mentee result exists and belongs to this instructor
    const [result] = await db
      .select()
      .from(menteeResults)
      .where(
        and(
          eq(menteeResults.id, resultId),
          eq(menteeResults.instructorId, instructor.id)
        )
      )
      .limit(1);

    if (!result) {
      return NextResponse.json(
        { error: "Mentee result not found" },
        { status: 404 }
      );
    }

    await db
      .delete(menteeResults)
      .where(eq(menteeResults.id, resultId));

    return NextResponse.json({
      success: true,
      message: "Mentee result deleted successfully",
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Error deleting mentee result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete mentee result" },
      { status: 500 }
    );
  }
}

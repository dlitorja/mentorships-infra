import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * DELETE /api/instructor/mentees-results/[resultId]
 * Delete a mentee result (only if it belongs to the current instructor)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ resultId: string }> }
) {
  try {
    const userId = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const { resultId } = await params;

    const results = await convex.query(api.instructors.getMenteeResultsByInstructorId, {
      instructorId: instructor._id,
    });

    const result = results.find(r => r._id === resultId);

    if (!result) {
      return NextResponse.json(
        { error: "Mentee result not found" },
        { status: 404 }
      );
    }

    await convex.mutation(api.instructors.deleteMenteeResult, {
      id: resultId as Id<"menteeResults">,
    });

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
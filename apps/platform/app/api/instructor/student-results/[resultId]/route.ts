import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * DELETE /api/instructor/student-results/[resultId]
 * Delete a student result (only if it belongs to the current instructor)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ resultId: string }> }
) {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const { resultId } = await params;

    const results = await convex.query(api.instructors.getStudentResultsByInstructorId, {
      instructorId: instructor._id,
    }) as any[];

    const result = results.find((r: any) => r._id === resultId);

    if (!result) {
      return NextResponse.json(
        { error: "Student result not found" },
        { status: 404 }
      );
    }

    await convex.mutation(api.instructors.deleteStudentResult, {
      id: resultId as Id<"studentResults">,
    });

    return NextResponse.json({
      success: true,
      message: "Student result deleted successfully",
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error deleting student result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete student result" },
      { status: 500 }
    );
  }
}
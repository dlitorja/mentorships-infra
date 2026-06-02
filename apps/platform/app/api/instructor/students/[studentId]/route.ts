import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * GET /api/instructor/students/[studentId]
 * Get detailed info about a specific student
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();
    const { studentId } = await params;

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const student = await convex.query(api.instructors.getStudentDetails, {
      instructorId: instructor._id,
      studentId: studentId,
    });

    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(student);
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Error fetching student details:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch student" },
      { status: 500 }
    );
  }
}
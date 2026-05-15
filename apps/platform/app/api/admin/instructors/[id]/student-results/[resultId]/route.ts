import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { auth } from "@clerk/nextjs/server";
import { resolveInstructorByIdOrSlug } from "@/lib/admin/instructors";

// Uses shared helper to avoid duplication across routes
 

/**
 * DELETE /api/admin/instructors/[id]/student-results/[resultId]
 * Delete a student result
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resultId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id, resultId } = await params;
    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const resolved = await resolveInstructorByIdOrSlug(convex, id);
    if (!resolved.resolvedId) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }
    const result = await convex.query(api.instructors.getStudentResultById, {
      id: resultId as Id<"studentResults">,
      instructorId: resolved.resolvedId,
    });

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
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error deleting student result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete student result" },
      { status: 500 }
    );
  }
}

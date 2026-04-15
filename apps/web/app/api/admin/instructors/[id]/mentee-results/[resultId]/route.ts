import { NextRequest, NextResponse } from "next/server";
import {
  db,
  menteeResults,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";
import { eq } from "drizzle-orm";

/**
 * DELETE /api/admin/instructors/[id]/mentee-results/[resultId]
 * Delete a mentee result
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resultId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { resultId } = await params;

    // Check if mentee result exists
    const [result] = await db
      .select()
      .from(menteeResults)
      .where(eq(menteeResults.id, resultId))
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
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error deleting mentee result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete mentee result" },
      { status: 500 }
    );
  }
}

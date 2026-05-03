import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { Id } from "@/convex/_generated/dataModel";

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

    const { id, resultId } = await params;

    const result = await fetchQuery(api.instructors.getMenteeResultById, {
      id: resultId as Id<"menteeResults">,
      instructorId: id,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Mentee result not found" },
        { status: 404 }
      );
    }

    await fetchMutation(api.instructors.deleteMenteeResult, {
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

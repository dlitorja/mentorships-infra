import { NextRequest, NextResponse } from "next/server";
import {
  db,
  instructorTestimonials,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";
import { eq, and } from "drizzle-orm";

/**
 * DELETE /api/admin/instructors/[id]/testimonials/[testimonialId]
 * Delete a testimonial
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; testimonialId: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id, testimonialId } = await params;

    // Check if testimonial exists and belongs to the instructor
    const [testimonial] = await db
      .select()
      .from(instructorTestimonials)
      .where(and(
        eq(instructorTestimonials.id, testimonialId),
        eq(instructorTestimonials.instructorId, id)
      ))
      .limit(1);

    if (!testimonial) {
      return NextResponse.json(
        { error: "Testimonial not found" },
        { status: 404 }
      );
    }

    await db
      .delete(instructorTestimonials)
      .where(eq(instructorTestimonials.id, testimonialId));

    return NextResponse.json({
      success: true,
      message: "Testimonial deleted successfully",
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error deleting testimonial:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete testimonial" },
      { status: 500 }
    );
  }
}

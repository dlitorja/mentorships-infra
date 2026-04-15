import { NextRequest, NextResponse } from "next/server";
import {
  db,
  instructorTestimonials,
  getInstructorByUserId,
  isUnauthorizedError,
} from "@mentorships/db";
import { eq, and } from "drizzle-orm";

/**
 * DELETE /api/instructor/testimonials/[testimonialId]
 * Delete a testimonial (only if it belongs to the current instructor)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ testimonialId: string }> }
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

    const { testimonialId } = await params;

    // Check if testimonial exists and belongs to this instructor
    const [testimonial] = await db
      .select()
      .from(instructorTestimonials)
      .where(
        and(
          eq(instructorTestimonials.id, testimonialId),
          eq(instructorTestimonials.instructorId, instructor.id)
        )
      )
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

    console.error("Error deleting testimonial:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete testimonial" },
      { status: 500 }
    );
  }
}

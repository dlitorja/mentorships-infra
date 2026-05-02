import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * DELETE /api/instructor/testimonials/[testimonialId]
 * Delete a testimonial (only if it belongs to the current instructor)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ testimonialId: string }> }
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

    const { testimonialId } = await params;

    const testimonials = await convex.query(api.instructors.getTestimonialsByInstructorId, {
      instructorId: instructor._id,
    });

    const testimonial = testimonials.find(t => t._id === testimonialId);

    if (!testimonial) {
      return NextResponse.json(
        { error: "Testimonial not found" },
        { status: 404 }
      );
    }

    await convex.mutation(api.instructors.deleteTestimonial, {
      id: testimonialId as Id<"instructorTestimonials">,
    });

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
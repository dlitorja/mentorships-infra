import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

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
    const convex = getConvexClient();

    const testimonial = await convex.query(api.instructors.getTestimonialById, {
      id: testimonialId as Id<"instructorTestimonials">,
      instructorId: id,
    });

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

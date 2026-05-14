import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import { resolveInstructorByIdOrSlug } from "@/lib/admin/instructors";

// Uses shared helper to avoid duplication across routes

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
    const testimonial = await convex.query(api.instructors.getTestimonialById, {
      id: testimonialId as Id<"instructorTestimonials">,
      instructorId: resolved.resolvedId,
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

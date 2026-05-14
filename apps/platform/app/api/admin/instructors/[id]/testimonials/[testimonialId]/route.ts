import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";

/** Resolve an instructor by Convex document id or slug. Only swallows errors related to invalid id formats. */
async function resolveInstructorByIdOrSlug(convex: ReturnType<typeof getConvexClient>, idOrSlug: string) {
  try {
    const byId = await convex.query(api.instructors.getInstructorById, { id: idOrSlug as any });
    if (byId) {
      return { instructor: byId, resolvedId: byId._id as string };
    }
  } catch (err) {
    if (!(err instanceof Error) || !/id|argument/i.test(err.message)) {
      // Network/auth or unexpected error: propagate
      throw err;
    }
  }
  const bySlug = await convex.query(api.instructors.getInstructorBySlugForAdmin, { slug: idOrSlug });
  if (bySlug) {
    return { instructor: bySlug, resolvedId: bySlug._id as string };
  }
  return { instructor: null, resolvedId: null } as const;
}

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

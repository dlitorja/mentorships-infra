import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { auth } from "@clerk/nextjs/server";

async function resolveInstructorByIdOrSlug(convex: ReturnType<typeof getConvexClient>, idOrSlug: string) {
  try {
    const byId = await convex.query(api.instructors.getInstructorById, { id: idOrSlug as any });
    if (byId) {
      return { instructor: byId, resolvedId: byId._id as string };
    }
  } catch (_) {
    // ignore invalid id format
  }
  const bySlug = await convex.query(api.instructors.getInstructorBySlugForAdmin, { slug: idOrSlug });
  if (bySlug) {
    return { instructor: bySlug, resolvedId: bySlug._id as string };
  }
  return { instructor: null, resolvedId: null } as const;
}

const createTestimonialSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  text: z.string().min(1, "Testimonial text is required"),
});

type CreateTestimonialInput = z.infer<typeof createTestimonialSchema>;

/**
 * POST /api/admin/instructors/[id]/testimonials
 * Add a testimonial to an instructor
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const body = await req.json();
    const validationResult = createTestimonialSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as CreateTestimonialInput;

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const resolved = await resolveInstructorByIdOrSlug(convex, id);
    const instructor = resolved.instructor;
    if (!instructor || !resolved.resolvedId) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const testimonial = await convex.mutation(api.instructors.createTestimonial, {
      instructorId: resolved.resolvedId as Id<"instructors">,
      name: data.name,
      text: data.text,
    });

    return NextResponse.json({
      success: true,
      message: "Testimonial added successfully",
      testimonial: {
        id: testimonial._id,
        name: testimonial.name,
        text: testimonial.text,
        createdAt: new Date(testimonial.createdAt ?? testimonial._creationTime).toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error adding testimonial:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add testimonial" },
      { status: 500 }
    );
  }
}

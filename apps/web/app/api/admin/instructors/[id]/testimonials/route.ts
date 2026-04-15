import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getInstructorById,
  createTestimonial,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";

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

    // Check if instructor exists
    const instructor = await getInstructorById(id);
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const testimonial = await createTestimonial({
      instructorId: id,
      name: data.name,
      text: data.text,
    });

    return NextResponse.json({
      success: true,
      message: "Testimonial added successfully",
      testimonial: {
        id: testimonial.id,
        name: testimonial.name,
        text: testimonial.text,
        createdAt: testimonial.createdAt.toISOString(),
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

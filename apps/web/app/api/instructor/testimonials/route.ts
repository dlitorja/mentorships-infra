import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getInstructorByUserId,
  getTestimonialsByInstructorId,
  createTestimonial,
  isUnauthorizedError,
} from "@mentorships/db";

const createTestimonialSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  text: z.string().min(1, "Testimonial text is required"),
});

/**
 * GET /api/instructor/testimonials
 * Get testimonials for the current instructor
 */
export async function GET(req: NextRequest) {
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

    const testimonials = await getTestimonialsByInstructorId(instructor.id);

    return NextResponse.json({
      items: testimonials.map((t) => ({
        id: t.id,
        name: t.name,
        text: t.text,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Error getting testimonials:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get testimonials" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/instructor/testimonials
 * Add a testimonial for the current instructor
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const validationResult = createTestimonialSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { name, text } = validationResult.data;

    const testimonial = await createTestimonial({
      instructorId: instructor.id,
      name,
      text,
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

    console.error("Error adding testimonial:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add testimonial" },
      { status: 500 }
    );
  }
}

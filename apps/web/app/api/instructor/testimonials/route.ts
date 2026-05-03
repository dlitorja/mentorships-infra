import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

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
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const testimonials = await convex.query(api.instructors.getTestimonialsByInstructorId, {
      instructorId: instructor._id,
    });

    return NextResponse.json({
      items: testimonials.map((t) => ({
        id: t._id,
        name: t.name,
        text: t.text,
        createdAt: new Date(t._creationTime).toISOString(),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
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
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

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

    const testimonialId = await convex.mutation(api.instructors.createTestimonial, {
      instructorId: instructor._id,
      name,
      text,
    });

    return NextResponse.json({
      success: true,
      message: "Testimonial added successfully",
      testimonial: {
        id: testimonialId,
        name,
        text,
        createdAt: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
    }

    console.error("Error adding testimonial:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add testimonial" },
      { status: 500 }
    );
  }
}
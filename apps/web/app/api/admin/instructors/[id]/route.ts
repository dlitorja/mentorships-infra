import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  instructors,
  instructorTestimonials,
  menteeResults,
  getInstructorById,
  updateInstructor,
  deleteInstructor,
  getTestimonialsByInstructorId,
  getMenteeResultsByInstructorId,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";
import { eq } from "drizzle-orm";

const updateInstructorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200).optional(),
  slug: z.string().min(1, "Slug is required").max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes").optional(),
  tagline: z.string().optional(),
  bio: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  background: z.array(z.string()).optional(),
  profileImageUrl: z.string().url().optional().or(z.literal("")).optional(),
  profileImageUploadPath: z.string().optional(),
  portfolioImages: z.array(z.string()).optional(),
  socials: z.object({
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    youtube: z.string().optional(),
    bluesky: z.string().optional(),
    website: z.string().optional(),
    artstation: z.string().optional(),
  }).optional().nullable(),
  isActive: z.boolean().optional(),
  userId: z.string().optional().nullable(),
});

type UpdateInstructorInput = z.infer<typeof updateInstructorSchema>;

/**
 * GET /api/admin/instructors/[id]
 * Get a single instructor with testimonials and mentee results
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;

    const instructor = await getInstructorById(id);
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const testimonials = await getTestimonialsByInstructorId(id);
    const menteeResultsData = await getMenteeResultsByInstructorId(id);

    return NextResponse.json({
      id: instructor.id,
      name: instructor.name,
      slug: instructor.slug,
      tagline: instructor.tagline,
      bio: instructor.bio,
      specialties: instructor.specialties,
      background: instructor.background,
      profileImageUrl: instructor.profileImageUrl,
      profileImageUploadPath: instructor.profileImageUploadPath,
      portfolioImages: instructor.portfolioImages,
      socials: instructor.socials,
      isActive: instructor.isActive,
      userId: instructor.userId,
      createdAt: instructor.createdAt.toISOString(),
      updatedAt: instructor.updatedAt.toISOString(),
      testimonials: testimonials.map((t) => ({
        id: t.id,
        name: t.name,
        text: t.text,
        createdAt: t.createdAt.toISOString(),
      })),
      menteeResults: menteeResultsData.map((r) => ({
        id: r.id,
        imageUrl: r.imageUrl,
        imageUploadPath: r.imageUploadPath,
        studentName: r.studentName,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error getting instructor:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get instructor" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/instructors/[id]
 * Update an instructor
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const body = await req.json();
    const validationResult = updateInstructorSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as UpdateInstructorInput;

    // Check if instructor exists
    const existing = await getInstructorById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    // Check if slug is being changed and if it's already taken
    if (data.slug && data.slug !== existing.slug) {
      const slugExists = await db.select().from(instructors).where(eq(instructors.slug, data.slug)).limit(1);
      if (slugExists.length > 0) {
        return NextResponse.json(
          { error: "Slug already exists" },
          { status: 400 }
        );
      }
    }

    const updated = await updateInstructor(id, {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.tagline !== undefined && { tagline: data.tagline || null }),
      ...(data.bio !== undefined && { bio: data.bio || null }),
      ...(data.specialties !== undefined && { specialties: data.specialties }),
      ...(data.background !== undefined && { background: data.background }),
      ...(data.profileImageUrl !== undefined && { profileImageUrl: data.profileImageUrl || null }),
      ...(data.profileImageUploadPath !== undefined && { profileImageUploadPath: data.profileImageUploadPath || null }),
      ...(data.portfolioImages !== undefined && { portfolioImages: data.portfolioImages }),
      ...(data.socials !== undefined && { socials: data.socials }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.userId !== undefined && { userId: data.userId }),
    });

    return NextResponse.json({
      success: true,
      message: "Instructor updated successfully",
      instructor: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        tagline: updated.tagline,
        bio: updated.bio,
        specialties: updated.specialties,
        background: updated.background,
        profileImageUrl: updated.profileImageUrl,
        portfolioImages: updated.portfolioImages,
        socials: updated.socials,
        isActive: updated.isActive,
        userId: updated.userId,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error updating instructor:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update instructor" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/instructors/[id]
 * Delete an instructor
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;

    // Check if instructor exists
    const existing = await getInstructorById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    await deleteInstructor(id);

    return NextResponse.json({
      success: true,
      message: "Instructor deleted successfully",
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error deleting instructor:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete instructor" },
      { status: 500 }
    );
  }
}

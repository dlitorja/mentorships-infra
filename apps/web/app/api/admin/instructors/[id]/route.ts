import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const updateInstructorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200).optional(),
  slug: z.string().min(1, "Slug is required").max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes").optional(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  tagline: z.string().optional(),
  bio: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  background: z.array(z.string()).optional(),
  profileImageUrl: z.string().optional().or(z.literal("")),
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
  deactivateProducts: z.boolean().optional(),
  oneOnOneInventory: z.number().int().min(0).optional(),
  groupInventory: z.number().int().min(0).optional(),
  maxActiveStudents: z.number().int().min(1).optional(),
  instructorId: z.string().optional().nullable().transform((v) => {
    if (v === undefined || v === null) return v;
    return v.trim() === "" ? null : v.trim();
  }),
});

type UpdateInstructorInput = z.infer<typeof updateInstructorSchema>;

/**
 * GET /api/admin/instructors/[id]
 * Get a single instructor with testimonials and student results
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorById, { id: id as any });
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const testimonials = await convex.query(api.instructors.getTestimonialsByInstructorId, { instructorId: id as any });
    const studentResultsData = await convex.query(api.instructors.getStudentResultsByInstructorId, { instructorId: id as any });

    return NextResponse.json({
      id: instructor._id,
      name: instructor.name,
      slug: instructor.slug,
      email: instructor.email,
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
      instructorId: instructor._id,
      legacyInstructorRef: instructor.legacyInstructorRef ?? null,
      oneOnOneInventory: (instructor as any).oneOnOneInventory ?? 0,
      groupInventory: (instructor as any).groupInventory ?? 0,
      maxActiveStudents: (instructor as any).maxActiveStudents ?? 10,
      createdAt: new Date(instructor._creationTime).toISOString(),
      updatedAt: instructor.updatedAt ? new Date(instructor.updatedAt).toISOString() : null,
      testimonials: testimonials.map((t: any) => ({
        id: t._id,
        name: t.name,
        text: t.text,
        createdAt: new Date(t._creationTime).toISOString(),
      })),
      studentResults: studentResultsData.map((r: any) => ({
        id: r._id,
        imageUrl: r.imageUrl,
        imageUploadPath: r.imageUploadPath,
        studentName: r.studentName,
        createdAt: new Date(r._creationTime).toISOString(),
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
      console.error("Validation error:", validationResult.error.issues);
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as UpdateInstructorInput;
    const convex = getConvexClient();

    const existing = await convex.query(api.instructors.getInstructorById, { id: id as any });
    if (!existing) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    if (data.slug && data.slug !== existing.slug) {
      const slugInstructor = await convex.query(api.instructors.getInstructorBySlugForAdmin, { slug: data.slug });
      if (slugInstructor && slugInstructor._id !== id) {
        return NextResponse.json(
          { error: "Slug already exists" },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.slug !== undefined) updateData.slug = data.slug;
    // Clear semantics: empty string -> null; non-empty -> lowercase string
    if (data.email !== undefined) {
      if (data.email === null || data.email === "") updateData.email = null;
      else updateData.email = data.email.toLowerCase();
    }
    if (data.tagline !== undefined) {
      updateData.tagline = data.tagline === "" ? null : data.tagline;
    }
    if (data.bio !== undefined) {
      updateData.bio = data.bio === "" ? null : data.bio;
    }
    if (data.specialties !== undefined) updateData.specialties = data.specialties;
    if (data.background !== undefined) updateData.background = data.background;
    if (data.profileImageUrl !== undefined) {
      updateData.profileImageUrl = data.profileImageUrl === "" ? null : data.profileImageUrl;
    }
    if (data.profileImageUploadPath !== undefined) {
      updateData.profileImageUploadPath = data.profileImageUploadPath === "" ? null : data.profileImageUploadPath;
    }
    if (data.portfolioImages !== undefined) updateData.portfolioImages = data.portfolioImages;
    if (data.socials !== undefined) {
      // Sanitize: keep only allowed keys with non-empty strings; clear if empty
      const allowed = ["twitter", "instagram", "youtube", "bluesky", "website", "artstation"];
      const sanitized: Record<string, string> = {};
      if (data.socials && typeof data.socials === "object" && !Array.isArray(data.socials)) {
        for (const [key, val] of Object.entries(data.socials as Record<string, unknown>)) {
          if (allowed.includes(key) && typeof val === "string" && val.length > 0) {
            sanitized[key] = val;
          }
        }
      }
      updateData.socials = Object.keys(sanitized).length > 0 ? sanitized : null;
    }
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    // Do NOT send userId to mutation; it is not supported in args
    if (data.maxActiveStudents !== undefined) updateData.maxActiveStudents = data.maxActiveStudents;
    if (data.oneOnOneInventory !== undefined) updateData.oneOnOneInventory = data.oneOnOneInventory;
    if (data.groupInventory !== undefined) updateData.groupInventory = data.groupInventory;
    if (data.instructorId !== undefined) updateData.legacyInstructorRef = data.instructorId;

    const updated = await convex.mutation(api.instructors.updateInstructor, {
      id: id as any,
      ...updateData,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update instructor" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Instructor updated successfully",
      instructor: {
        id: updated._id,
        name: updated.name,
        slug: updated.slug,
        email: updated.email,
        tagline: updated.tagline,
        bio: updated.bio,
        specialties: updated.specialties,
        background: updated.background,
        profileImageUrl: updated.profileImageUrl,
        portfolioImages: updated.portfolioImages,
        socials: sanitizeSocials((updated as any).socials),
        isActive: updated.isActive,
        userId: updated.userId,
        instructorId: updated._id,
        legacyInstructorRef: (updated as any).legacyInstructorRef ?? null,
        oneOnOneInventory: (updated as any).oneOnOneInventory ?? 0,
        groupInventory: (updated as any).groupInventory ?? 0,
        maxActiveStudents: (updated as any).maxActiveStudents ?? 10,
        updatedAt: updated.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
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
 * Delete an instructor (soft delete)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const convex = getConvexClient();

    const existing = await convex.query(api.instructors.getInstructorById, { id: id as any });
    if (!existing) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    await convex.mutation(api.instructors.deleteInstructor, { id: id as any });

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
function sanitizeSocials(value: unknown): Record<string, string> {
  const allowed = ["twitter", "instagram", "youtube", "bluesky", "website", "artstation"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (allowed.includes(key) && typeof val === "string" && val.length > 0) {
      result[key] = val;
    }
  }
  return result;
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  instructors,
  mentors,
  mentorshipProducts,
  sessionPacks,
  getInstructors,
  createInstructor,
  isUnauthorizedError,
  isForbiddenError,
  eq,
  and,
  gt,
  isNull,
  or,
} from "@mentorships/db";

const createInstructorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  slug: z.string().min(1, "Slug is required").max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes"),
  tagline: z.string().optional().default(""),
  bio: z.string().optional().default(""),
  specialties: z.array(z.string()).optional().default([]),
  background: z.array(z.string()).optional().default([]),
  profileImageUrl: z.string().optional().or(z.literal("")).default(""),
  profileImageUploadPath: z.string().optional().default(""),
  portfolioImages: z.array(z.string()).optional().default([]),
  socials: z.object({
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    youtube: z.string().optional(),
    bluesky: z.string().optional(),
    website: z.string().optional(),
    artstation: z.string().optional(),
  }).optional(),
  isActive: z.boolean().default(true),
  userId: z.string().optional(),
  mentorId: z.string().uuid().optional(),
});

const listInstructorsQuerySchema = z.object({
  search: z.string().trim().default(""),
  includeInactive: z.enum(["true", "false"]).transform((val) => val === "true").optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type CreateInstructorInput = z.infer<typeof createInstructorSchema>;

/**
 * GET /api/admin/instructors
 * List all instructors for admin dashboard with filtering and pagination
 */
export async function GET(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const parsedQuery = listInstructorsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const { search, includeInactive, page, pageSize } = parsedQuery.data;
    const offset = (page - 1) * pageSize;

    const { items: allInstructors, total } = await getInstructors({
      includeInactive,
      search,
      limit: pageSize,
      offset,
    });

    return NextResponse.json({
      items: allInstructors.map((inst) => ({
        id: inst.id,
        name: inst.name,
        slug: inst.slug,
        tagline: inst.tagline,
        specialties: inst.specialties,
        background: inst.background,
        profileImageUrl: inst.profileImageUrl,
        isActive: inst.isActive,
        mentorId: inst.mentorId,
        createdAt: inst.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error listing instructors:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list instructors" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/instructors
 * Create a new instructor
 */
export async function POST(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const body = await req.json();
    const validationResult = createInstructorSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as CreateInstructorInput;

    // Check if slug already exists
    const existing = await db.select().from(instructors).where(eq(instructors.slug, data.slug)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Slug already exists" },
        { status: 400 }
      );
    }

    // Validate mentorId exists if provided
    if (data.mentorId) {
      const mentorExists = await db.select().from(mentors).where(eq(mentors.id, data.mentorId)).limit(1);
      if (mentorExists.length === 0) {
        return NextResponse.json(
          { error: "Mentor not found" },
          { status: 400 }
        );
      }
    }

    // Validation: Check for active mentees if creating with isActive: false and mentorId
    if (data.isActive === false && data.mentorId) {
      const activeMentees = await db
        .select()
        .from(sessionPacks)
        .where(
          and(
            eq(sessionPacks.mentorId, data.mentorId),
            eq(sessionPacks.status, "active"),
            gt(sessionPacks.remainingSessions, 0),
            or(
              isNull(sessionPacks.expiresAt),
              gt(sessionPacks.expiresAt, new Date())
            )
          )
        );

      if (activeMentees.length > 0) {
        return NextResponse.json(
          {
            error: "Cannot create inactive instructor with active mentees",
            activeMenteeCount: activeMentees.length,
          },
          { status: 400 }
        );
      }
    }

    const instructor = await createInstructor({
      name: data.name,
      slug: data.slug,
      tagline: data.tagline || null,
      bio: data.bio || null,
      specialties: data.specialties || [],
      background: data.background || [],
      profileImageUrl: data.profileImageUrl || null,
      profileImageUploadPath: data.profileImageUploadPath || null,
      portfolioImages: data.portfolioImages || [],
      socials: data.socials || null,
      isActive: data.isActive,
      userId: data.userId || null,
      mentorId: data.mentorId || null,
    });

    return NextResponse.json({
      success: true,
      message: "Instructor created successfully",
      instructor: {
        id: instructor.id,
        name: instructor.name,
        slug: instructor.slug,
        tagline: instructor.tagline,
        bio: instructor.bio,
        specialties: instructor.specialties,
        background: instructor.background,
        profileImageUrl: instructor.profileImageUrl,
        portfolioImages: instructor.portfolioImages,
        socials: instructor.socials,
        isActive: instructor.isActive,
        mentorId: instructor.mentorId,
        createdAt: instructor.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error creating instructor:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create instructor" },
      { status: 500 }
    );
  }
}

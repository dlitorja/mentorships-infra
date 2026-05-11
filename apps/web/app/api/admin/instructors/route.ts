import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { createClerkInvitation } from "@/lib/clerk-invitations";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getAdminInstructors } from "@mentorships/db";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const createInstructorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  slug: z.string().min(1, "Slug is required").max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes"),
  email: z.string().email().optional().or(z.literal("")).default(""),
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
  oneOnOneInventory: z.number().int().min(0).optional().default(0),
  groupInventory: z.number().int().min(0).optional().default(0),
  maxActiveStudents: z.number().int().min(1).optional().default(10),
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

    const result = await getAdminInstructors(
      search || undefined,
      includeInactive,
      page,
      pageSize
    );

    return NextResponse.json({
      items: result.items.map((inst) => ({
        kind: "instructor" as const,
        id: inst.id,
        name: inst.name,
        slug: inst.slug,
        email: inst.email,
        userId: inst.userId,
        tagline: inst.tagline,
        specialties: inst.specialties,
        background: inst.background,
        profileImageUrl: inst.profileImageUrl,
        isActive: inst.isActive,
        instructorId: inst.id,
        createdAt: new Date(inst.createdAt).toISOString(),
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
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
  console.log("[createInstructor] Starting");
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    console.log("[createInstructor] Checking auth");
    await requireRoleForApi("admin");
    console.log("[createInstructor] Auth passed");

    const body = await req.json();
    console.log("[createInstructor] Body:", JSON.stringify(body).slice(0, 200));
    const validationResult = createInstructorSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as CreateInstructorInput;
    const convex = getConvexClient();

    const userId = data.userId || crypto.randomUUID();

    console.log("[createInstructor] Creating instructor in Convex");
    let instructorId: string;
    try {
      instructorId = await convex.mutation(api.instructors.createInstructor, {
        userId,
        name: data.name,
        slug: data.slug,
        email: data.email ? data.email.toLowerCase() : undefined,
        tagline: data.tagline || undefined,
        bio: data.bio || undefined,
        specialties: data.specialties,
        background: data.background,
        profileImageUrl: data.profileImageUrl || undefined,
        profileImageUploadPath: data.profileImageUploadPath || undefined,
        portfolioImages: data.portfolioImages,
        socials: data.socials || undefined,
        isActive: data.isActive,
        isNew: true,
        maxActiveStudents: data.maxActiveStudents,
        oneOnOneInventory: data.oneOnOneInventory,
        groupInventory: data.groupInventory,
      });
      console.log("[createInstructor] Created:", instructorId);
    } catch (err: any) {
      if (err.message === "Slug already exists") {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
      }
      throw err;
    }

    let invitationSent = false;
    let invitationError: string | undefined;

    if (data.email) {
      console.log("[createInstructor] Creating Clerk invitation for:", data.email);
      const normalizedEmail = data.email.toLowerCase();
      const invitationResult = await createClerkInvitation({
        emailAddress: normalizedEmail,
        instructorId,
      });

      invitationSent = invitationResult.success;
      invitationError = invitationResult.error;

      if (!invitationResult.success) {
        console.warn(`Failed to send Clerk invitation to ${data.email}:`, invitationResult.error);
      }
    }

    const instructor = await convex.query(api.instructors.getInstructorById, { id: instructorId as any });

    return NextResponse.json({
      success: true,
      message: "Instructor created successfully",
      instructor: {
        id: instructor?._id,
        name: instructor?.name,
        slug: instructor?.slug,
        tagline: instructor?.tagline,
        bio: instructor?.bio,
        specialties: instructor?.specialties,
        background: instructor?.background,
        profileImageUrl: instructor?.profileImageUrl,
        portfolioImages: instructor?.portfolioImages,
        socials: instructor?.socials,
        isActive: instructor?.isActive,
        instructorId: instructor?._id,
        email: instructor?.email,
        createdAt: instructor ? new Date(instructor._creationTime).toISOString() : null,
      },
      inventory: {
        oneOnOneInventory: data.oneOnOneInventory,
        groupInventory: data.groupInventory,
        maxActiveStudents: data.maxActiveStudents,
      },
      invitationSent,
      invitationError,
    }, { status: 201 });
  } catch (error) {
    console.error("[createInstructor] Error:", error);
    console.error("[createInstructor] Error type:", error?.constructor?.name);
    if (error && typeof error === 'object' && 'cause' in error) {
      console.error("[createInstructor] Error cause:", (error as {cause: unknown}).cause);
    }
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
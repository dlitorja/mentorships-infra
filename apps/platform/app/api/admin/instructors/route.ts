import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { createClerkInvitation } from "@/lib/clerk-invitations";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Returns a ConvexHttpClient using NEXT_PUBLIC_CONVEX_URL.
 * Note: This does not authenticate requests by itself; routes are expected to
 * enforce auth (e.g., requireRoleForApi("admin")) and attach a Clerk Convex
 * token to the client where needed.
 */
function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * GET /api/admin/instructors
 * Lists instructors with lightweight stats for the admin UI. Requires admin role.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireRoleForApi("admin");

    const convex = getConvexClient();

    const instructors = await convex.query(api.instructors.getInstructorsForAdmin, {});

    // Compute product-active flags with bounded concurrency to avoid N+1 spikes
    const productFlags = new Map<string, { oneOnOne: boolean; group: boolean }>();
    const list = instructors as any[];
    const chunkSize = 8;
    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(async (inst) => {
          try {
            const products = (await convex.query(api.products.getProductsByInstructorId, { instructorId: inst._id })) as any[] | null;
            const activeProducts = (products ?? []).filter((p) => p.active && !p.deletedAt);
            const hasOneOnOne = activeProducts.some((p) => p.mentorshipType === "one-on-one");
            const hasGroup = activeProducts.some((p) => p.mentorshipType === "group");
            return { id: inst._id as string, oneOnOne: hasOneOnOne, group: hasGroup };
          } catch (e) {
            console.error("Failed to load products for instructor", inst._id, e);
            return { id: inst._id as string, oneOnOne: false, group: false };
          }
        })
      );
      results.forEach((r) => productFlags.set(r.id, { oneOnOne: r.oneOnOne, group: r.group }));
    }

    const instructorsWithStats = list.map((instructor) => {
      const flags = productFlags.get(instructor._id) || { oneOnOne: false, group: false };
      return {
        instructorId: instructor._id,
        userId: instructor.userId || "",
        email: instructor.email || "",
        displayName: instructor.name || instructor.email || "",
        oneOnOneInventory: instructor.oneOnOneInventory || 0,
        groupInventory: instructor.groupInventory || 0,
        maxActiveStudents: instructor.maxActiveStudents || 0,
        // Align naming with admin UI expectations
        activeStudentCount: instructor.activeStudentCount || 0,
        productActiveOneOnOne: flags.oneOnOne,
        productActiveGroup: flags.group,
        createdAt: instructor.createdAt
          ? new Date(instructor.createdAt).toISOString()
          : new Date(instructor._creationTime).toISOString(),
      };
    });

    return NextResponse.json({ instructors: instructorsWithStats });
  } catch (error) {
    console.error("Error fetching instructors:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Validates the admin create-instructor request body.
 */
const createInstructorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(200)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes"),
  email: z.string().email().optional().or(z.literal("")).default(""),
  discordVoiceChannelUrl: z
    .string()
    .regex(/^https:\/\/(?:discord\.gg|discord(?:app)?\.com)\/.+$/)
    .optional()
    .or(z.literal(""))
    .default(""),
  tagline: z.string().optional().default(""),
  bio: z.string().optional().default(""),
  specialties: z.array(z.string()).optional().default([]),
  background: z.array(z.string()).optional().default([]),
  profileImageUrl: z.string().optional().or(z.literal("")).default(""),
  profileImageUploadPath: z.string().optional().default(""),
  portfolioImages: z.array(z.string()).optional().default([]),
  socials: z
    .object({
      twitter: z.string().optional(),
      instagram: z.string().optional(),
      youtube: z.string().optional(),
      bluesky: z.string().optional(),
      website: z.string().optional(),
      artstation: z.string().optional(),
    })
    .optional(),
  isActive: z.boolean().default(true),
  userId: z.string().optional(),
  oneOnOneInventory: z.number().int().min(0).optional().default(0),
  groupInventory: z.number().int().min(0).optional().default(0),
  maxActiveStudents: z.number().int().min(1).optional().default(10),
});

/**
 * POST /api/admin/instructors
 * Creates a new instructor in Convex and (optionally) sends a Clerk invitation.
 * - Admin only
 * - Returns 201 on success with the created instructor id and inventory
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireRoleForApi("admin");

    // Parse JSON body safely to avoid unhandled exceptions on malformed JSON
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
    }

    const parsed = createInstructorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json({ error: "Server misconfigured: NEXT_PUBLIC_CONVEX_URL" }, { status: 500 });
    }

    const convex = new ConvexHttpClient(convexUrl);

    // Convex createInstructor requires userId. If not provided, fall back to an admin-scoped placeholder.
    // This follows the existing pattern used in httpAdminSyncInventory (`admin-${slug}`).
    const userId: string = data.userId ?? `admin-${data.slug}`;

    let instructorId: Id<"instructors">;
    try {
      instructorId = await convex.mutation(api.instructors.createInstructor, {
        userId: userId,
        name: data.name,
        slug: data.slug,
        email: data.email ? data.email.toLowerCase() : undefined,
        discordVoiceChannelUrl: data.discordVoiceChannelUrl ? data.discordVoiceChannelUrl : undefined,
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
    } catch (err: any) {
      if (err?.message === "Slug already exists") {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
      }
      throw err;
    }

    let invitationSent = false;
    let invitationError: string | undefined;
    if (data.email) {
      try {
        const result = await createClerkInvitation({
          emailAddress: data.email.toLowerCase(),
          instructorId,
        });
        invitationSent = result.success;
        invitationError = result.error;
      } catch (e: unknown) {
        // Invitation failures shouldn't fail creation; surface error instead
        let message = "Failed to send invitation";
        if (typeof e === "object" && e !== null && "message" in e && typeof (e as any).message === "string") {
          message = (e as any).message as string;
        }
        console.error("[platform:createInstructor] Clerk invitation error:", message);
        invitationSent = false;
        invitationError = message;
      }
    }

    const instructor = await convex.query(api.instructors.getInstructorById, { id: instructorId });

      return NextResponse.json(
        {
          success: true,
          message: "Instructor created successfully",
          instructor: {
            id: instructor?._id ?? (instructorId as string),
            name: instructor?.name ?? data.name,
            slug: instructor?.slug ?? data.slug,
            email: instructor?.email ?? data.email ?? null,
            discordVoiceChannelUrl: (instructor as any)?.discordVoiceChannelUrl ?? (data.discordVoiceChannelUrl || null),
            profileImageUrl: instructor?.profileImageUrl ?? null,
            createdAt: instructor ? new Date(instructor._creationTime).toISOString() : null,
          },
        inventory: {
          oneOnOneInventory: data.oneOnOneInventory,
          groupInventory: data.groupInventory,
          maxActiveStudents: data.maxActiveStudents,
        },
        invitationSent,
        invitationError,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    console.error("[platform:createInstructor] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create instructor" },
      { status: 500 }
    );
  }
}

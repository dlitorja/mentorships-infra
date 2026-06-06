import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";
import { auth } from "@clerk/nextjs/server";
import { resolveInstructorByIdOrSlug } from "@/lib/admin/instructors";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

// Uses shared helper to avoid duplication across routes

const SOCIALS_KEYS = new Set(["twitter", "instagram", "youtube", "bluesky", "website", "artstation"]);

function sanitizeSocials(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SOCIALS_KEYS.has(key) && typeof val === "string" && val.length > 0) {
      result[key] = val;
    }
  }
  return result;
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
  // Only allow HTTPS Discord links (discord.gg, discord.com, discordapp.com)
  discordVoiceChannelUrl: z
    .string()
    .regex(/^https:\/\/(?:discord\.gg|discord(?:app)?\.com)\/.+$/)
    .optional()
    .or(z.literal(""))
    .nullable(),
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
  maxActiveStudents: z.number().int().min(0).optional(),
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
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const resolved = await resolveInstructorByIdOrSlug(convex, id);

    // Narrow unknown instructor result from resolver to a minimal document shape
    type InstructorDoc = {
      _id: string;
      name?: string;
      slug?: string;
      email?: string | null;
      tagline?: string | null;
      bio?: string | null;
      specialties?: any;
      background?: any;
      profileImageUrl?: string | null;
      profileImageUploadPath?: string | null;
      portfolioImages?: any;
      socials?: any;
      isActive?: boolean;
      userId?: string | null;
      legacyInstructorRef?: string | null;
      oneOnOneInventory?: number;
      groupInventory?: number;
      maxActiveStudents?: number;
      updatedAt?: number | string | null;
      _creationTime?: number;
    };
    const isInstructor = (obj: unknown): obj is InstructorDoc =>
      !!obj && typeof obj === "object" && "_id" in obj;

    const instructor = resolved.instructor as InstructorDoc & { discordVoiceChannelUrl?: string | null };
    if (!isInstructor(instructor)) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const testimonials = await convex.query(
      api.instructors.getTestimonialsByInstructorId,
      { instructorId: (resolved.resolvedId ?? instructor._id) as any }
    );
    const studentResultsData = await convex.query(
      api.instructors.getStudentResultsByInstructorId,
      { instructorId: (resolved.resolvedId ?? instructor._id) as any }
    );

    return NextResponse.json({
      id: instructor._id,
      name: instructor.name,
      slug: instructor.slug,
      email: instructor.email ?? null,
      discordVoiceChannelUrl: instructor.discordVoiceChannelUrl ?? null,
      tagline: instructor.tagline ?? null,
      bio: instructor.bio ?? null,
      specialties: instructor.specialties ?? [],
      background: instructor.background ?? [],
      profileImageUrl: instructor.profileImageUrl ?? null,
      profileImageUploadPath: instructor.profileImageUploadPath ?? null,
      portfolioImages: instructor.portfolioImages ?? [],
      socials: sanitizeSocials(instructor.socials),
      isActive: instructor.isActive,
      userId: instructor.userId ?? null,
      legacyInstructorRef: instructor.legacyInstructorRef ?? null,
      instructorId: instructor.legacyInstructorRef ?? null,
      oneOnOneInventory: instructor.oneOnOneInventory ?? 0,
      groupInventory: instructor.groupInventory ?? 0,
      maxActiveStudents: instructor.maxActiveStudents ?? 10,
      createdAt: new Date(instructor._creationTime ?? Date.now()).toISOString(),
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
      console.error("Validation error:", JSON.stringify(validationResult.error.issues, null, 2), "Body received:", JSON.stringify(body));
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as UpdateInstructorInput;
    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const resolved = await resolveInstructorByIdOrSlug(convex, id);
    const existing = resolved.instructor;
    const resolvedId = resolved.resolvedId;
    if (!existing || !resolvedId) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    // Narrow existing for slug comparison without broad casting
    const getExistingSlug = (obj: unknown): string | undefined =>
      obj && typeof obj === "object" && "slug" in obj ? (obj as any).slug : undefined;

    if (data.slug && data.slug !== getExistingSlug(existing)) {
      const slugInstructor = await convex.query(api.instructors.getInstructorBySlugForAdmin, { slug: data.slug });
      if (slugInstructor && slugInstructor._id !== resolvedId) {
        return NextResponse.json(
          { error: "Slug already exists" },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.slug !== undefined) updateData.slug = data.slug;
    // Clear means remove: empty string -> null; non-empty -> lowercase
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
    // Normalize list fields to arrays of non-empty strings only to avoid Convex arg type errors
    if (data.specialties !== undefined) {
      // Zod already enforces string[]; just trim and drop empties
      updateData.specialties = data.specialties.map((s) => s.trim()).filter((s) => s.length > 0);
    }
    if (data.background !== undefined) {
      updateData.background = data.background.map((s) => s.trim()).filter((s) => s.length > 0);
    }
    if (data.profileImageUrl !== undefined) {
      updateData.profileImageUrl = data.profileImageUrl === "" ? null : data.profileImageUrl;
    }
    if (data.profileImageUploadPath !== undefined) {
      updateData.profileImageUploadPath = data.profileImageUploadPath === "" ? null : data.profileImageUploadPath;
    }
    if (data.portfolioImages !== undefined) {
      updateData.portfolioImages = data.portfolioImages.map((s) => s.trim()).filter((s) => s.length > 0);
    }
    if (data.socials !== undefined) {
      const sanitized = sanitizeSocials(data.socials);
      updateData.socials = Object.keys(sanitized).length > 0 ? sanitized : null;
    }
    if (data.discordVoiceChannelUrl !== undefined) {
      if (data.discordVoiceChannelUrl === null || data.discordVoiceChannelUrl === "") {
        updateData.discordVoiceChannelUrl = null;
      } else {
        updateData.discordVoiceChannelUrl = data.discordVoiceChannelUrl;
      }
    }
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    // Do NOT send userId in update payload; mutation args don't accept it
    if (data.maxActiveStudents !== undefined) updateData.maxActiveStudents = data.maxActiveStudents;
    if (data.oneOnOneInventory !== undefined) updateData.oneOnOneInventory = data.oneOnOneInventory;
    if (data.groupInventory !== undefined) updateData.groupInventory = data.groupInventory;
    if (data.instructorId !== undefined) updateData.legacyInstructorRef = data.instructorId;

    let updated: any;
    try {
      updated = await convex.mutation(api.instructors.updateInstructor, {
        id: resolvedId as any,
        ...updateData,
      });
    } catch (err: any) {
      const msg: string = err?.message || String(err);
      // Extract Convex request id when available, keep null when not matched
      const requestId = (() => {
        const m = msg.match(/\[Request ID: ([^\]]+)\]/);
        return m ? m[1] : null;
      })();
      console.error("Convex updateInstructor failed", {
        requestId,
        message: msg,
        resolvedId,
        updateDataKeys: Object.keys(updateData),
      });
      // Error classification:
      // - Likely invalid arguments/schema mismatch: return 400
      // - Otherwise preserve 5xx to avoid masking outages
      const looksLikeArgValidation = /ArgumentValidationError|Value does not match validator|Invalid arguments|Invalid value for/i.test(
        msg
      );
      if (looksLikeArgValidation) {
        return NextResponse.json(
          {
            error: "Invalid Convex mutation arguments",
            requestId,
            details: "Update payload failed Convex validator",
          },
          { status: 400 }
        );
      }

      // If Convex reports a generic "Server Error" but we can't confirm it's validation-related, keep 502
      if (/Server Error/i.test(msg)) {
        return NextResponse.json(
          {
            error: "Upstream Convex server error",
            requestId,
            details: "Convex returned a server error while updating instructor",
          },
          { status: 502 }
        );
      }

      // Unknown error shape – rethrow to outer handler
      throw err;
    }

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
        email: updated.email ?? null,
        tagline: updated.tagline ?? null,
        bio: updated.bio ?? null,
        specialties: updated.specialties ?? [],
        background: updated.background ?? [],
        profileImageUrl: updated.profileImageUrl ?? null,
        profileImageUploadPath: updated.profileImageUploadPath ?? null,
        portfolioImages: updated.portfolioImages ?? [],
        socials: sanitizeSocials(updated.socials),
        isActive: updated.isActive,
        userId: updated.userId ?? null,
        legacyInstructorRef: updated.legacyInstructorRef ?? null,
        instructorId: updated?.legacyInstructorRef ?? null,
        oneOnOneInventory: updated?.oneOnOneInventory ?? 0,
        groupInventory: updated?.groupInventory ?? 0,
        maxActiveStudents: updated?.maxActiveStudents ?? 10,
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
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const resolved = await resolveInstructorByIdOrSlug(convex, id);
    const existing = resolved.instructor;
    const resolvedId = resolved.resolvedId;
    if (!existing || !resolvedId) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    await convex.mutation(api.instructors.deleteInstructor, { id: resolvedId as any });

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

/**
 * PURGE /api/admin/instructors/[id]
 * Permanently delete an instructor (hard delete - irreversible)
 */
export async function PURGE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const resolved = await resolveInstructorByIdOrSlug(convex, id);
    const existing = resolved.instructor;
    const resolvedId = resolved.resolvedId;
    if (!existing || !resolvedId) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    await convex.mutation(api.instructors.hardDeleteInstructor, { id: resolvedId as any });

    return NextResponse.json({
      success: true,
      message: "Instructor permanently deleted",
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error permanently deleting instructor:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to permanently delete instructor" },
      { status: 500 }
    );
  }
}

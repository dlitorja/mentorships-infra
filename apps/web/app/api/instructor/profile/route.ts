import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

const socialsSchema = z.object({
  twitter: z.string().optional(),
  instagram: z.string().optional(),
  youtube: z.string().optional(),
  bluesky: z.string().optional(),
  website: z.string().optional(),
  artstation: z.string().optional(),
});

const patchSchema = z.object({
  name: z.string().min(1, "Name is required").max(200).optional(),
  tagline: z.string().max(500).optional().nullable(),
  bio: z.string().optional().nullable(),
  specialties: z.array(z.string()).optional(),
  background: z.array(z.string()).optional(),
  profileImageUrl: z.string().optional().nullable(),
  profileImageUploadPath: z.string().optional().nullable(),
  portfolioImages: z.array(z.string()).optional(),
  socials: socialsSchema.optional().nullable(),
});

type PatchInput = z.infer<typeof patchSchema>;

interface ExistingInstructor {
  profileImageUrl: string | null;
  portfolioImages: string[] | null;
}

function validateProfileRequirements(
  existing: ExistingInstructor,
  data: PatchInput
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const profileImageUrl = data.profileImageUrl !== undefined
    ? data.profileImageUrl
    : existing.profileImageUrl;
  const hasProfileImage = !!profileImageUrl && profileImageUrl.trim() !== "";

  const portfolioImages = data.portfolioImages !== undefined
    ? data.portfolioImages
    : existing.portfolioImages ?? [];
  const portfolioCount = portfolioImages.length;

  if (!hasProfileImage) {
    errors.push("Profile image is required");
  }

  if (portfolioCount < 4) {
    errors.push(`At least 4 portfolio images required (currently ${portfolioCount})`);
  }

  return { valid: errors.length === 0, errors };
}

export async function GET(): Promise<NextResponse> {
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

    return NextResponse.json({
      id: instructor._id,
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
      createdAt: new Date(instructor._creationTime).toISOString(),
      updatedAt: instructor.updatedAt ? new Date(instructor.updatedAt).toISOString() : new Date(instructor._creationTime).toISOString(),
    });
  } catch (error) {
    console.error("Get instructor profile error:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
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
    const parsed = patchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const validation = validateProfileRequirements(instructor, parsed.data);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Profile requirements not met", validationErrors: validation.errors },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const updated = await convex.mutation(api.instructors.updateInstructor, {
      id: instructor._id,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.tagline !== undefined && { tagline: data.tagline }),
      ...(data.bio !== undefined && { bio: data.bio }),
      ...(data.specialties !== undefined && { specialties: data.specialties }),
      ...(data.background !== undefined && { background: data.background }),
      ...(data.profileImageUrl !== undefined && { profileImageUrl: data.profileImageUrl }),
      ...(data.profileImageUploadPath !== undefined && { profileImageUploadPath: data.profileImageUploadPath }),
      ...(data.portfolioImages !== undefined && { portfolioImages: data.portfolioImages }),
      ...(data.socials !== undefined && { socials: data.socials }),
    });

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
      profile: {
        id: updated?._id,
        name: updated?.name,
        slug: updated?.slug,
        tagline: updated?.tagline,
        bio: updated?.bio,
        specialties: updated?.specialties,
        background: updated?.background,
        profileImageUrl: updated?.profileImageUrl,
        profileImageUploadPath: updated?.profileImageUploadPath,
        portfolioImages: updated?.portfolioImages,
        socials: updated?.socials,
        isActive: updated?.isActive,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Update instructor profile error:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
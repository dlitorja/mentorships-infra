import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  instructors,
  mentors,
  instructorTestimonials,
  menteeResults,
  mentorshipProducts,
  sessionPacks,
  getInstructorById,
  updateInstructor,
  deleteInstructor,
  getTestimonialsByInstructorId,
  getMenteeResultsByInstructorId,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";
import { eq, gt, and, isNull, or } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { inngest } from "@/inngest/client";

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
  mentorId: z.string().uuid().optional().nullable(),
  deactivateProducts: z.boolean().optional(),
  oneOnOneInventory: z.number().int().min(0).optional(),
  groupInventory: z.number().int().min(0).optional(),
  maxActiveStudents: z.number().int().min(1).optional(),
});

type UpdateInstructorInput = z.infer<typeof updateInstructorSchema>;

async function checkActiveMentees(mentorId: string): Promise<number> {
  const activeMentees = await db
    .select()
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.mentorId, mentorId),
        eq(sessionPacks.status, "active"),
        gt(sessionPacks.remainingSessions, 0),
        or(
          isNull(sessionPacks.expiresAt),
          gt(sessionPacks.expiresAt, new Date())
        )
      )
    );
  return activeMentees.length;
}

async function checkActiveProducts(mentorId: string) {
  const products = await db
    .select()
    .from(mentorshipProducts)
    .where(
      and(
        eq(mentorshipProducts.mentorId, mentorId),
        eq(mentorshipProducts.active, true)
      )
    );
  return products;
}

async function deactivateProductsOnStripe(products: typeof mentorshipProducts.$inferSelect[]) {
  const results = {
    success: [] as string[],
    failed: [] as { id: string; error: string }[],
  };

  for (const product of products) {
    if (product.stripeProductId) {
      try {
        await stripe.products.update(product.stripeProductId, { active: false });
        results.success.push(product.stripeProductId);
      } catch (error) {
        results.failed.push({
          id: product.stripeProductId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    if (product.stripePriceId) {
      try {
        await stripe.prices.update(product.stripePriceId, { active: false });
        results.success.push(product.stripePriceId);
      } catch (error) {
        results.failed.push({
          id: product.stripePriceId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  return results;
}

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
      mentorId: instructor.mentorId,
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
      console.error("Validation error:", validationResult.error.issues);
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as UpdateInstructorInput;

    const existing = await getInstructorById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    if (data.slug && data.slug !== existing.slug) {
      const slugExists = await db.select().from(instructors).where(eq(instructors.slug, data.slug)).limit(1);
      if (slugExists.length > 0) {
        return NextResponse.json(
          { error: "Slug already exists" },
          { status: 400 }
        );
      }
    }

    // Validate mentorId if being changed
    if (data.mentorId !== undefined && data.mentorId !== existing.mentorId) {
      // Check mentor exists (only if not null)
      if (data.mentorId !== null) {
        const mentorExists = await db.select().from(mentors).where(eq(mentors.id, data.mentorId)).limit(1);
        if (mentorExists.length === 0) {
          return NextResponse.json(
            { error: "Mentor not found" },
            { status: 400 }
          );
        }

        // Check if mentorId is already assigned to another instructor
        const existingAssignment = await db
          .select({ id: instructors.id })
          .from(instructors)
          .where(eq(instructors.mentorId, data.mentorId))
          .limit(1);
        if (existingAssignment.length > 0 && existingAssignment[0].id !== id) {
          return NextResponse.json(
            { error: "Mentor is already assigned to another instructor" },
            { status: 400 }
          );
        }
      }
    }

    const mentorId = Object.prototype.hasOwnProperty.call(data, "mentorId") ? data.mentorId : existing.mentorId;

    if (data.isActive === false && existing.isActive !== false) {
      if (mentorId) {
        const activeMenteeCount = await checkActiveMentees(mentorId);
        if (activeMenteeCount > 0) {
          return NextResponse.json(
            {
              error: "Cannot deactivate instructor with active mentees",
              activeMenteeCount,
            },
            { status: 400 }
          );
        }

        const activeProducts = await checkActiveProducts(mentorId);

        if (activeProducts.length > 0 && !data.deactivateProducts) {
          return NextResponse.json(
            {
              error: "Instructor has active products",
              activeProducts: activeProducts.map((p) => ({
                id: p.id,
                title: p.title,
                stripeProductId: p.stripeProductId,
                stripePriceId: p.stripePriceId,
              })),
              requiresProductDeactivation: true,
            },
            { status: 400 }
          );
        }

        if (activeProducts.length > 0 && data.deactivateProducts) {
          const stripeResults = await deactivateProductsOnStripe(activeProducts);

          // Only mark products inactive in DB where Stripe succeeded
          const successfulStripeIds = new Set([...stripeResults.success]);

          for (const product of activeProducts) {
            const productStripeId = product.stripeProductId;
            const priceStripeId = product.stripePriceId;

            // Require ALL Stripe operations for this product to succeed
            const productSucceeded = !productStripeId || successfulStripeIds.has(productStripeId);
            const priceSucceeded = !priceStripeId || successfulStripeIds.has(priceStripeId);
            const stripeSucceeded = productSucceeded && priceSucceeded;

            if (stripeSucceeded) {
              await db
                .update(mentorshipProducts)
                .set({ active: false })
                .where(eq(mentorshipProducts.id, product.id));
            }
          }

          // Only deactivate instructor if ALL products fully succeeded
          const failedProducts = activeProducts.filter((p) => {
            const productStripeId = p.stripeProductId;
            const priceStripeId = p.stripePriceId;
            const productSucceeded = !productStripeId || successfulStripeIds.has(productStripeId);
            const priceSucceeded = !priceStripeId || successfulStripeIds.has(priceStripeId);
            return !(productSucceeded && priceSucceeded);
          });

          if (failedProducts.length === 0) {
            await updateInstructor(id, { isActive: false });
          }

          return NextResponse.json({
            success: true,
            message: "Instructor and products deactivated",
            productsDeactivated: {
              stripeSuccess: stripeResults.success,
              stripeFailed: stripeResults.failed,
            },
          });
        }
      }
    }

    const updateData: Partial<typeof instructors.$inferInsert> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.slug !== undefined) updateData.slug = data.slug;
    if (data.tagline !== undefined) updateData.tagline = data.tagline || null;
    if (data.bio !== undefined) updateData.bio = data.bio || null;
    if (data.specialties !== undefined) updateData.specialties = data.specialties;
    if (data.background !== undefined) updateData.background = data.background;
    if (data.profileImageUrl !== undefined) updateData.profileImageUrl = data.profileImageUrl || null;
    if (data.profileImageUploadPath !== undefined) updateData.profileImageUploadPath = data.profileImageUploadPath || null;
    if (data.portfolioImages !== undefined) updateData.portfolioImages = data.portfolioImages;
    if (data.socials !== undefined) updateData.socials = data.socials;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.userId !== undefined) updateData.userId = data.userId;
    if (data.mentorId !== undefined) updateData.mentorId = data.mentorId || null;
    if (data.email !== undefined) updateData.email = data.email ? data.email.toLowerCase() : null;

    // Check if inventory fields are being updated
    const inventoryFieldsChanged =
      data.oneOnOneInventory !== undefined ||
      data.groupInventory !== undefined ||
      data.maxActiveStudents !== undefined;

    const updated = await updateInstructor(id, updateData);

    // Sync inventory to Convex via Inngest if inventory fields changed
    if (inventoryFieldsChanged && existing.slug) {
      await inngest.send({
        name: "instructor/updated",
        data: {
          slug: existing.slug,
          name: existing.name,
          email: existing.email,
          oneOnOneInventory: data.oneOnOneInventory,
          groupInventory: data.groupInventory,
          maxActiveStudents: data.maxActiveStudents,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: "Instructor updated successfully",
      instructor: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        email: updated.email,
        tagline: updated.tagline,
        bio: updated.bio,
        specialties: updated.specialties,
        background: updated.background,
        profileImageUrl: updated.profileImageUrl,
        portfolioImages: updated.portfolioImages,
        socials: updated.socials,
        isActive: updated.isActive,
        userId: updated.userId,
        mentorId: updated.mentorId,
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  mentorshipProducts,
  mentors,
  eq,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";
import { stripe } from "@/lib/stripe";
import { requireRoleForApi } from "@/lib/auth-helpers";

const updateProductSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  price: z.string().refine(
    (val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num > 0;
    },
    { message: "Price must be a positive number" }
  ),
  currency: z.string().length(3).default("usd"),
  sessionsPerPack: z.number().int().min(1).max(100),
  validityDays: z.number().int().min(1).max(365),
  enableStripe: z.boolean(),
  enablePayPal: z.boolean(),
  deactivateOldPrice: z.boolean().default(true),
});

type UpdateProductInput = z.infer<typeof updateProductSchema>;

/**
 * GET /api/admin/products/[id]
 * Get single product by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRoleForApi("admin");
    const { id } = await params;

    const [product] = await db
      .select({
        product: mentorshipProducts,
        mentor: mentors,
      })
      .from(mentorshipProducts)
      .leftJoin(mentors, eq(mentorshipProducts.mentorId, mentors.id))
      .where(eq(mentorshipProducts.id, id))
      .limit(1);

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: product.product.id,
      mentorId: product.product.mentorId,
      mentorName: "Mentor",
      title: product.product.title,
      price: product.product.price,
      sessionsPerPack: product.product.sessionsPerPack,
      validityDays: product.product.validityDays,
      stripePriceId: product.product.stripePriceId,
      paypalProductId: product.product.paypalProductId,
      active: product.product.active,
      createdAt: product.product.createdAt.toISOString(),
      updatedAt: product.product.updatedAt.toISOString(),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error getting product:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get product" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/products/[id]
 * Update a product in Stripe and database
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let newStripePriceId: string | undefined;
  let oldStripePriceId: string | undefined;

  try {
    await requireRoleForApi("admin");
    const { id } = await params;

    const body = await req.json();
    const validationResult = updateProductSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const {
      title,
      price,
      currency,
      sessionsPerPack,
      validityDays,
      enableStripe,
      enablePayPal,
      deactivateOldPrice,
    } = validationResult.data as UpdateProductInput;

    // Get existing product
    const [existingProduct] = await db
      .select()
      .from(mentorshipProducts)
      .where(eq(mentorshipProducts.id, id))
      .limit(1);

    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    oldStripePriceId = existingProduct.stripePriceId || undefined;

    // Check if price changed - need to create new Stripe price
    const priceChanged = parseFloat(existingProduct.price) !== parseFloat(price);

    if (priceChanged && enableStripe && oldStripePriceId) {
      // Get the Stripe product ID from the current price
      try {
        const oldPrice = await stripe.prices.retrieve(oldStripePriceId);
        const stripeProductId = oldPrice.product as string;

        // Create new price
        const newPrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: Math.round(parseFloat(price) * 100),
          currency: currency.toLowerCase(),
          active: true,
        });
        newStripePriceId = newPrice.id;

        // Deactivate old price if requested (keeps record but new customers can't use it)
        if (deactivateOldPrice) {
          await stripe.prices.update(oldStripePriceId, { active: false });
        }
      } catch (stripeError) {
        console.error("Failed to create new Stripe price:", stripeError);
        return NextResponse.json(
          { error: "Failed to create new price in Stripe" },
          { status: 500 }
        );
      }
    }

// Update Stripe product if price changed
    if (oldStripePriceId) {
      try {
        const oldPrice = await stripe.prices.retrieve(oldStripePriceId);
        const stripeProductId = oldPrice.product as string;
        await stripe.products.update(stripeProductId, {
          name: title,
          metadata: {
            sessions: sessionsPerPack.toString(),
            validityDays: validityDays.toString(),
          },
        });
      } catch (stripeError) {
        console.error("Failed to update Stripe product:", stripeError);
      }
    }

    // Determine paypalProductId value
    let newPaypalProductId: string | null = existingProduct.paypalProductId;
    if (!enablePayPal) {
      newPaypalProductId = null;
    } else if (enablePayPal && !newPaypalProductId) {
      newPaypalProductId = "enabled";
    }

    // Update product in database
    const [updatedProduct] = await db
      .update(mentorshipProducts)
      .set({
        title,
        price,
        sessionsPerPack,
        validityDays,
        stripePriceId: newStripePriceId || existingProduct.stripePriceId,
        paypalProductId: newPaypalProductId,
        active: enableStripe && enablePayPal,
        updatedAt: new Date(),
      })
      .where(eq(mentorshipProducts.id, id))
      .returning();

    return NextResponse.json({
      success: true,
      message: "Product updated successfully",
      product: {
        id: updatedProduct.id,
        title: updatedProduct.title,
        price: updatedProduct.price,
        sessionsPerPack: updatedProduct.sessionsPerPack,
        validityDays: updatedProduct.validityDays,
        stripePriceId: updatedProduct.stripePriceId,
        paypalProductId: updatedProduct.paypalProductId,
        active: updatedProduct.active,
      },
      changes: {
        priceChanged,
        newStripePriceId: newStripePriceId || null,
        oldStripePriceId: deactivateOldPrice ? oldStripePriceId : null,
      },
    });
  } catch (error) {
    // Cleanup: if we created a new price but update failed, deactivate it
    if (newStripePriceId) {
      try {
        await stripe.prices.update(newStripePriceId, { active: false });
      } catch (cleanupError) {
        console.error("Failed to cleanup Stripe price:", cleanupError);
      }
    }

    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error updating product:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update product" },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { stripe } from "@/lib/stripe";

const updateProductSchema = z.object({
  mentorId: z.string().optional(),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().optional().default(""),
  imageUrl: z.string().url().optional().or(z.literal("")),
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
  mentorshipType: z.enum(["one-on-one", "group"]).optional(),
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

    const convex = getConvexClient();
    const product = await convex.query(api.products.getProductForAdmin, {
      id: id as Id<"products">,
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: product._id,
      mentorId: product.mentorId,
      mentorName: product.instructorName,
      title: product.title,
      description: product.description,
      imageUrl: product.imageUrl,
      price: product.price,
      currency: product.currency,
      sessionsPerPack: product.sessionsPerPack,
      validityDays: product.validityDays,
      mentorshipType: product.mentorshipType,
      stripePriceId: product.stripePriceId,
      stripeProductId: product.stripeProductId,
      paypalProductId: product.paypalProductId,
      active: product.active,
      createdAt: new Date(product._creationTime).toISOString(),
      updatedAt: new Date(product._creationTime).toISOString(),
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
      mentorId,
      title,
      description,
      imageUrl,
      price,
      currency,
      sessionsPerPack,
      validityDays,
      mentorshipType,
      enableStripe,
      enablePayPal,
      deactivateOldPrice,
    } = validationResult.data as UpdateProductInput;

    const convex = getConvexClient();

    const existingProduct = await convex.query(api.products.getProductById, {
      id: id as Id<"products">,
    });

    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    oldStripePriceId = existingProduct.stripePriceId || undefined;

    const priceChanged = parseFloat(existingProduct.price) !== parseFloat(price);

    if (priceChanged && enableStripe && oldStripePriceId) {
      try {
        const oldPrice = await stripe.prices.retrieve(oldStripePriceId);
        const stripeProductId = oldPrice.product as string;

        const newPrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: Math.round(parseFloat(price) * 100),
          currency: currency.toLowerCase(),
          active: true,
        });
        newStripePriceId = newPrice.id;

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

    let newPaypalProductId: string | null = existingProduct.paypalProductId ?? null;
    if (!enablePayPal) {
      newPaypalProductId = null;
    } else if (enablePayPal && !newPaypalProductId) {
      newPaypalProductId = "enabled";
    }

    const updatedProduct = await convex.mutation(api.products.updateProduct, {
      id: id as Id<"products">,
      title,
      description: description || undefined,
      imageUrl: imageUrl || undefined,
      price,
      sessionsPerPack,
      validityDays,
      ...(mentorshipType && { mentorshipType }),
      stripePriceId: newStripePriceId || undefined,
      paypalProductId: newPaypalProductId ?? undefined,
      active: enableStripe || enablePayPal,
    });

    if (!updatedProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Product updated successfully",
      product: {
        id: updatedProduct._id,
        mentorId: updatedProduct.mentorId,
        title: updatedProduct.title,
        description: updatedProduct.description ?? null,
        imageUrl: updatedProduct.imageUrl ?? null,
        price: updatedProduct.price,
        currency: updatedProduct.currency,
        sessionsPerPack: updatedProduct.sessionsPerPack,
        validityDays: updatedProduct.validityDays,
        mentorshipType: updatedProduct.mentorshipType ?? null,
        stripePriceId: updatedProduct.stripePriceId ?? null,
        stripeProductId: updatedProduct.stripeProductId ?? null,
        paypalProductId: updatedProduct.paypalProductId ?? null,
        active: updatedProduct.active,
      },
      changes: {
        priceChanged,
        newStripePriceId: newStripePriceId || null,
        oldStripePriceId: deactivateOldPrice ? oldStripePriceId : null,
      },
    });
  } catch (error) {
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
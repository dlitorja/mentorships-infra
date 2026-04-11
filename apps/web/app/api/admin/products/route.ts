import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
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

const createProductSchema = z.object({
  mentorId: z.string().uuid("Invalid mentor ID format"),
  title: z.string().min(1, "Title is required").max(200),
  price: z.string().refine(
    (val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num > 0;
    },
    { message: "Price must be a positive number" }
  ),
  currency: z.string().length(3).default("usd"),
  sessionsPerPack: z.number().int().min(1).max(100).default(4),
  validityDays: z.number().int().min(1).max(365).default(30),
  enableStripe: z.boolean().default(true),
  enablePayPal: z.boolean().default(true),
});

type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * POST /api/admin/products
 * Create a product in Stripe, PayPal, and database
 * 
 * This creates products in the payment providers from the admin dashboard,
 * so admins don't need to manually create them in Stripe/PayPal dashboards.
 * 
 * PayPal uses dynamic product creation through orders - we mark it as enabled
 * and it will be created on first purchase.
 */
export async function POST(req: NextRequest) {
  let stripeProductId: string | undefined;
  let stripePriceId: string | undefined;

  try {
    await requireRoleForApi("admin");

    const body = await req.json();
    const validationResult = createProductSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const {
      mentorId,
      title,
      price,
      currency,
      sessionsPerPack,
      validityDays,
      enableStripe,
      enablePayPal,
    } = validationResult.data as CreateProductInput;

    // Verify mentor exists
    const [mentor] = await db
      .select()
      .from(mentors)
      .where(eq(mentors.id, mentorId))
      .limit(1);

    if (!mentor) {
      return NextResponse.json(
        { error: "Mentor not found" },
        { status: 404 }
      );
    }

    // Stripe Product ID (for tracking in Stripe dashboard)
    if (enableStripe) {
      try {
        // Create product in Stripe
        const stripeProduct = await stripe.products.create({
          name: title,
          metadata: {
            sessions: sessionsPerPack.toString(),
            validityDays: validityDays.toString(),
          },
        });

        stripeProductId = stripeProduct.id;

        // Create price in Stripe
        const stripePrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: Math.round(parseFloat(price) * 100),
          currency: currency.toLowerCase(),
        });

        stripePriceId = stripePrice.id;
      } catch (stripeError) {
        console.error("Failed to create Stripe product:", stripeError);
        return NextResponse.json(
          { error: "Failed to create product in Stripe", details: stripeError instanceof Error ? stripeError.message : undefined },
          { status: 500 }
        );
      }
    }

    // For PayPal, products are created dynamically with orders
    // We just mark it as enabled - it will be created on first checkout
    // This is the expected PayPal behavior for simple integrations

    // Create product in database
    const [product] = await db
      .insert(mentorshipProducts)
      .values({
        mentorId,
        title,
        price,
        stripePriceId,
        paypalProductId: enablePayPal ? "enabled" : null,
        sessionsPerPack,
        validityDays,
        active: true,
      })
      .returning();

    return NextResponse.json({
      success: true,
      message: "Product created successfully",
      product: {
        title,
        price,
        currency,
        sessionsPerPack,
        validityDays,
        stripe: enableStripe ? {
          productId: stripeProductId,
          priceId: stripePriceId,
        } : null,
        paypal: enablePayPal ? {
          status: "enabled (dynamic creation)",
        } : null,
      },
    });
  } catch (error) {
    // Cleanup Stripe resources on failure
    if (stripePriceId) {
      try {
        await stripe.prices.update(stripePriceId, { active: false });
        await stripe.products.update(stripeProductId!, { active: false });
      } catch (cleanupError) {
        console.error("Failed to cleanup Stripe resources:", cleanupError);
      }
    }

    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create product" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/products
 * List all products for admin dashboard
 */
export async function GET(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const products = await db
      .select({
        product: mentorshipProducts,
        mentor: mentors,
      })
      .from(mentorshipProducts)
      .leftJoin(mentors, eq(mentorshipProducts.mentorId, mentors.id))
      .orderBy(mentorshipProducts.createdAt);

    return NextResponse.json({
      items: products.map(({ product, mentor }) => ({
        id: product.id,
        mentorId: product.mentorId,
        mentorName: "Mentor",
        title: product.title,
        price: product.price,
        sessionsPerPack: product.sessionsPerPack,
        validityDays: product.validityDays,
        stripePriceId: product.stripePriceId,
        paypalProductId: product.paypalProductId,
        active: product.active,
        createdAt: product.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error listing products:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list products" },
      { status: 500 }
    );
  }
}
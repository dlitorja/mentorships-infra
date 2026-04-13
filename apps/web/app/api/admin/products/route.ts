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
import {
  createPayPalProduct,
  getPayPalProductDashboardLink,
} from "@mentorships/payments";

const createProductSchema = z.object({
  mentorId: z.string().uuid("Invalid mentor ID format"),
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
  sessionsPerPack: z.number().int().min(1).max(100).default(4),
  validityDays: z.number().int().min(1).max(365).default(30),
  mentorshipType: z.enum(["one-on-one", "group"]).default("one-on-one"),
  enableStripe: z.boolean().default(true),
  enablePayPal: z.boolean().default(true),
});

type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * POST /api/admin/products
 * Create a product in Stripe, PayPal, and database
 */
export async function POST(req: NextRequest) {
  let stripeProductId: string | undefined;
  let stripePriceId: string | undefined;
  let paypalProductId: string | undefined;

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
      description,
      imageUrl,
      price,
      currency,
      sessionsPerPack,
      validityDays,
      mentorshipType,
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

    // Create product in Stripe
    if (enableStripe) {
      try {
        const stripeProduct = await stripe.products.create({
          name: title,
          description: description || undefined,
          metadata: {
            sessions: sessionsPerPack.toString(),
            validityDays: validityDays.toString(),
            mentorshipType,
          },
        });

        stripeProductId = stripeProduct.id;

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

    // Create product in PayPal
    if (enablePayPal) {
      try {
        const paypalResult = await createPayPalProduct({
          name: title,
          description: description || `${title} - Mentorship Session Pack`,
          type: "SERVICE",
          imageUrl: imageUrl || undefined,
        });
        paypalProductId = paypalResult.id;
      } catch (paypalError) {
        console.error("Failed to create PayPal product:", paypalError);
        // If PayPal creation fails, we can still continue without it
        // but log the error
        paypalProductId = undefined;
      }
    }

    // Create product in database
    const [product] = await db
      .insert(mentorshipProducts)
      .values({
        mentorId,
        title,
        description: description || null,
        imageUrl: imageUrl || null,
        price,
        currency,
        stripePriceId,
        stripeProductId: stripeProductId || null,
        paypalProductId: paypalProductId || null,
        sessionsPerPack,
        validityDays,
        mentorshipType,
        active: true,
      })
      .returning();

    // Build response with links
    const response: {
      success: boolean;
      message: string;
      product: {
        id: string;
        title: string;
        price: string;
        currency: string;
        sessionsPerPack: number;
        validityDays: number;
        mentorshipType: string;
        stripe: {
          productId: string;
          productLink: string;
          priceId: string;
          priceLink: string;
        } | null;
        paypal: {
          productId: string;
          productLink: string;
        } | null;
      };
    } = {
      success: true,
      message: "Product created successfully",
      product: {
        id: product.id,
        title,
        price,
        currency,
        sessionsPerPack,
        validityDays,
        mentorshipType,
        stripe: enableStripe && stripeProductId ? {
          productId: stripeProductId,
          productLink: `https://dashboard.stripe.com/products/${stripeProductId}`,
          priceId: stripePriceId!,
          priceLink: `https://dashboard.stripe.com/prices/${stripePriceId}`,
        } : null,
        paypal: paypalProductId ? {
          productId: paypalProductId,
          productLink: getPayPalProductDashboardLink(paypalProductId),
        } : null,
      },
    };

    return NextResponse.json(response);
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

    const products: { product: typeof mentorshipProducts.$inferSelect; mentor: typeof mentors.$inferSelect | null }[] = await db
      .select({
        product: mentorshipProducts,
        mentor: mentors,
      })
      .from(mentorshipProducts)
      .leftJoin(mentors, eq(mentorshipProducts.mentorId, mentors.id))
      .orderBy(mentorshipProducts.createdAt);

    return NextResponse.json({
      items: products.map(({ product, mentor: _mentor }) => ({
        id: product.id,
        mentorId: product.mentorId,
        mentorName: "Mentor",
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

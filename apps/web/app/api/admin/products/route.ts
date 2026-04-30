import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { stripe } from "@/lib/stripe";
import { requireRoleForApi } from "@/lib/auth-helpers";
import {
  createPayPalProduct,
  getPayPalProductDashboardLink,
  deletePayPalProduct,
} from "@mentorships/payments";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const createProductSchema = z.object({
  mentorId: z.string().min(1, "Mentor ID is required"),
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
}).refine(
  (data) => data.enableStripe || data.enablePayPal,
  {
    message: "At least one payment provider must be enabled",
    path: ["enableStripe"],
  }
);

type CreateProductInput = z.infer<typeof createProductSchema>;

const listProductsQuerySchema = z.object({
  search: z.string().trim().default(""),
  mentorId: z.string().optional(),
  mentorshipType: z.enum(["one-on-one", "group"]).optional(),
  active: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * POST /api/admin/products
 * Create a product in Stripe, PayPal, and Convex
 */
export async function POST(req: NextRequest) {
  let stripeProductId: string | undefined;
  let stripePriceId: string | undefined;
  let paypalProductId: string | undefined;
  let convexProductId: string | undefined;

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

    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorById, { id: mentorId as any });
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

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
        if (stripeProductId) {
          try {
            await stripe.products.update(stripeProductId, { active: false });
          } catch (cleanupError) {
            console.error("Failed to cleanup Stripe product:", cleanupError);
          }
        }
        return NextResponse.json(
          { error: "Failed to create product in Stripe", details: stripeError instanceof Error ? stripeError.message : undefined },
          { status: 500 }
        );
      }
    }

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
        paypalProductId = undefined;
      }
    }

    try {
      convexProductId = await convex.mutation(api.products.createProduct, {
        mentorId: mentorId as Id<"instructors">,
        title,
        description: description || undefined,
        imageUrl: imageUrl || undefined,
        price,
        currency,
        sessionsPerPack,
        validityDays,
        stripePriceId: stripePriceId || undefined,
        stripeProductId: stripeProductId || undefined,
        paypalProductId: paypalProductId || undefined,
        mentorshipType,
        active: true,
      });

      const response = {
        success: true,
        message: "Product created successfully",
        product: {
          id: convexProductId,
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
    } catch (convexError) {
      console.error("Failed to create product in Convex:", convexError);
      if (paypalProductId) {
        try {
          await deletePayPalProduct(paypalProductId);
        } catch (cleanupError) {
          console.error("Failed to cleanup PayPal product:", cleanupError);
        }
      }
      if (stripePriceId) {
        try {
          await stripe.prices.update(stripePriceId, { active: false });
        } catch (cleanupError) {
          console.error("Failed to cleanup Stripe price:", cleanupError);
        }
      }
      if (stripeProductId) {
        try {
          await stripe.products.update(stripeProductId, { active: false });
        } catch (cleanupError) {
          console.error("Failed to cleanup Stripe product:", cleanupError);
        }
      }
      return NextResponse.json(
        { error: "Failed to create product in Convex", details: convexError instanceof Error ? convexError.message : undefined },
        { status: 500 }
      );
    }
  } catch (error) {
    if (stripePriceId) {
      try {
        await stripe.prices.update(stripePriceId, { active: false });
      } catch (cleanupError) {
        console.error("Failed to cleanup Stripe price:", cleanupError);
      }
    }
    if (stripeProductId) {
      try {
        await stripe.products.update(stripeProductId, { active: false });
      } catch (cleanupError) {
        console.error("Failed to cleanup Stripe product:", cleanupError);
      }
    }

    if (error instanceof Error && "status" in error) {
      const err = error as { status: number; message: string };
      if (err.status === 401) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (err.status === 403) {
        return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
      }
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
 * List all products for admin dashboard with filtering and pagination
 */
export async function GET(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const parsedQuery = listProductsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const { search, mentorId, mentorshipType, active, page, pageSize } = parsedQuery.data;

    const convex = getConvexClient();

    let products;
    if (mentorId) {
      products = await convex.query(api.products.getProductsByInstructorAndType, {
        mentorId: mentorId as Id<"instructors">,
        mentorshipType: mentorshipType || undefined,
      });
    } else {
      products = await convex.query(api.products.getPublicActiveProducts, {});
    }

    let filtered = products;

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(searchLower) ||
        (p.description && p.description.toLowerCase().includes(searchLower))
      );
    }

    if (mentorshipType) {
      filtered = filtered.filter(p => p.mentorshipType === mentorshipType);
    }

    if (active !== undefined) {
      filtered = filtered.filter(p => p.active === active);
    }

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paginatedItems = filtered.slice(offset, offset + pageSize);

    const itemsWithMentorName = await Promise.all(
      paginatedItems.map(async (product) => {
        let mentorName = "Unknown Instructor";
        if (product.mentorId) {
          try {
            const instructor = await convex.query(api.instructors.getInstructorById, {
              id: product.mentorId as any,
            });
            if (instructor?.name) {
              mentorName = instructor.name;
            }
          } catch {
          }
        }

        return {
          id: product._id,
          mentorId: product.mentorId,
          mentorName,
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
          paypalProductLink: product.paypalProductId
            ? getPayPalProductDashboardLink(product.paypalProductId)
            : null,
          active: product.active,
          createdAt: new Date(product._creationTime).toISOString(),
        };
      })
    );

    return NextResponse.json({
      items: itemsWithMentorName,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const err = error as { status: number; message: string };
      if (err.status === 401) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (err.status === 403) {
        return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
      }
    }

    console.error("Error listing products:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list products" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Stripe from "stripe";
import {
  requireAuth,
  getProductById,
  updateOrderStatus,
  getGrandfatheredDiscount,
  getGrandfatheredConfig,
  createOrder,
} from "@mentorships/db";
import { stripe } from "@/lib/stripe";

const checkoutSchema = z.object({
  packId: z.string().min(1, "packId is required"),
  promotionCode: z.string().optional(), // Optional promotion code from customer input
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let orderId: string | null = null;

  try {
    const userId = await requireAuth();
    const body = await req.json();
    
    // Validate request body
    const validationResult = checkoutSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }
    
    const { packId, promotionCode } = validationResult.data;

    // Get pack details from database
    const pack = await getProductById(packId);

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }

    if (!pack.stripePriceId) {
      return NextResponse.json(
        { error: "Stripe price ID not configured for this pack" },
        { status: 400 }
      );
    }

    // Check for grandfathered pricing
    const grandfatheredConfig = getGrandfatheredConfig();
    const grandfatheredDiscount = await getGrandfatheredDiscount(
      userId,
      grandfatheredConfig
    );

    // Determine which discount to use (customer-entered code takes precedence)
    const discountCode = promotionCode || grandfatheredDiscount?.promotionCode;
    const couponId = !promotionCode ? grandfatheredDiscount?.couponId : undefined;

    // Create order in database (status: pending)
    const order = await createOrder(
        userId,
      "stripe",
      pack.price,
      "usd"
    );

    orderId = order.id;

    // Determine base URL - only use environment variables for security
    let baseUrl: string;
    if (process.env.NEXT_PUBLIC_URL) {
      baseUrl = process.env.NEXT_PUBLIC_URL;
    } else if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      // Development fallback - throw error in production
      if (process.env.NODE_ENV === "production") {
        throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
      }
      baseUrl = "http://localhost:3000";
    }

    // Build discounts array for Stripe Checkout
    const discounts: Array<{ coupon?: string; promotion_code?: string }> = [];
    
    if (couponId) {
      // Auto-apply coupon for grandfathered users
      discounts.push({ coupon: couponId });
    } else if (discountCode) {
      // Use promotion code (either customer-entered or grandfathered)
      discounts.push({ promotion_code: discountCode });
    }

    // Create Stripe Checkout Session with error handling
    let session: Stripe.Checkout.Session;
    try {
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "payment", // One-time payment (NOT subscription!)
        line_items: [
          {
            price: pack.stripePriceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout/cancel`,
        metadata: {
          order_id: order.id, // Critical: Link to your order
          user_id: userId,
          pack_id: packId,
        },
        // Enable promotion codes if no auto-apply discount (allows customers to enter codes)
        allow_promotion_codes: discounts.length === 0,
      };

      // Add discounts if we have any (auto-apply)
      if (discounts.length > 0) {
        sessionParams.discounts = discounts;
      }

      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (stripeError) {
      // Mark order as failed if Stripe session creation fails
      if (orderId) {
        try {
          await updateOrderStatus(orderId, "failed");
        } catch (updateError) {
          console.error(`Failed to update order ${orderId} to failed:`, updateError);
        }
      }
      throw stripeError;
    }

    // Return checkout URL
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);

    // Cleanup: Mark order as failed if still pending (idempotent)
    if (orderId) {
      try {
          await updateOrderStatus(orderId, "failed");
          console.log(`Marked orphaned order ${orderId} as failed`);
      } catch (cleanupError) {
        console.error(`Failed to cleanup order ${orderId}:`, cleanupError);
      }
    }

    return NextResponse.json(
      { error: "Checkout failed" },
      { status: 500 }
    );
  }
}

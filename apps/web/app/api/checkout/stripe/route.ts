import { NextRequest, NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth";
import {
  validateProductForPurchase,
  createOrder,
  checkSeatAvailability,
} from "@mentorships/db";
import { createCheckoutSession } from "@mentorships/payments";

/**
 * POST /api/checkout/stripe
 * Create a Stripe checkout session for a mentorship product
 * 
 * Body:
 * {
 *   productId: string (UUID)
 * }
 * 
 * Returns:
 * {
 *   success: true,
 *   checkoutUrl: string,
 *   orderId: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const user = await requireDbUser();

    // Parse request body
    const body = await request.json();
    const { productId } = body;

    // Validate required fields
    if (!productId) {
      return NextResponse.json(
        { error: "productId is required" },
        { status: 400 }
      );
    }

    // Validate product exists and is available
    const validation = await validateProductForPurchase(productId);
    if (!validation.valid || !validation.product) {
      return NextResponse.json(
        { error: validation.reason || "Product is not available for purchase" },
        { status: 400 }
      );
    }

    const product = validation.product;

    // Check if Stripe is configured for this product
    if (!product.stripePriceId) {
      return NextResponse.json(
        { error: "Product does not have Stripe pricing configured" },
        { status: 400 }
      );
    }

    // Check seat availability for the mentor
    const seatAvailability = await checkSeatAvailability(product.mentorId);
    if (!seatAvailability.available) {
      return NextResponse.json(
        {
          error: "No seats available for this mentor",
          availableSeats: seatAvailability.activeSeats,
          maxSeats: seatAvailability.maxSeats,
        },
        { status: 409 } // Conflict
      );
    }

    // Get base URL for redirect URLs
    const baseUrl =
      process.env.NEXT_PUBLIC_URL ||
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : request.headers.get("origin") ||
          `http://${request.headers.get("host") || "localhost:3000"}`;

    // Create order in database (status: pending)
    const order = await createOrder(
      user.id,
      "stripe",
      product.price,
      "usd"
    );

    // Create Stripe checkout session
    const { url: checkoutUrl } = await createCheckoutSession(
      product.stripePriceId,
      {
        userId: user.id,
        mentorId: product.mentorId,
        productId: product.id,
        orderId: order.id,
      },
      `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      `${baseUrl}/checkout/cancel?order_id=${order.id}`
    );

    return NextResponse.json({
      success: true,
      checkoutUrl,
      orderId: order.id,
    });
  } catch (error) {
    console.error("Stripe checkout error:", error);

    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}


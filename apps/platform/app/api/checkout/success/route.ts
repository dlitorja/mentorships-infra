import { NextRequest, NextResponse } from "next/server";
import { getCheckoutSession, parseCheckoutSessionMetadata } from "@mentorships/payments";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";

/**
 * GET /api/checkout/success
 * Handle successful checkout redirect from Stripe
 *
 * Query params:
 * - session_id: Stripe checkout session ID
 *
 * Redirects to success page with order details
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  try {
    // Retrieve checkout session from Stripe
    const session = await getCheckoutSession(sessionId);

    // Parse metadata to get order ID
    const metadata = parseCheckoutSessionMetadata(session);
    if (!metadata || !metadata.orderId) {
      return NextResponse.json(
        { error: "Invalid checkout session metadata" },
        { status: 400 }
      );
    }

    // Verify order exists in Convex before redirecting
    const convex = getConvexClient();
    const order = await convex.query(api.orders.getOrderByIdPublic, {
      id: metadata.orderId as Id<"orders">,
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    // Build redirect URL
    const baseUrl =
      process.env.NEXT_PUBLIC_URL ||
      (request.headers.get("origin") || "http://localhost:3000");

    // Use NextResponse.redirect to avoid redirect being caught by try/catch
    return NextResponse.redirect(
      new URL(`/checkout/success?order_id=${encodeURIComponent(metadata.orderId)}`, baseUrl)
    );
  } catch (error) {
    console.error("Checkout success handler error:", error);

    return NextResponse.json(
      { error: "Failed to process checkout success" },
      { status: 500 }
    );
  }
}


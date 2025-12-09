import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getCheckoutSession, parseCheckoutSessionMetadata } from "@mentorships/payments";
import { getOrderById } from "@mentorships/db";

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
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

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

    // Get order from database
    const order = await getOrderById(metadata.orderId);
    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    // Redirect to success page with order ID
    const baseUrl =
      process.env.NEXT_PUBLIC_URL ||
      (request.headers.get("origin") || "http://localhost:3000");

    redirect(`${baseUrl}/checkout/success?order_id=${order.id}`);
  } catch (error) {
    console.error("Checkout success handler error:", error);

    return NextResponse.json(
      { error: "Failed to process checkout success" },
      { status: 500 }
    );
  }
}


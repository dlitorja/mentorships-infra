import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { updateOrderStatus } from "@mentorships/db";

/**
 * GET /api/checkout/cancel
 * Handle canceled checkout redirect from Stripe
 * 
 * Query params:
 * - order_id: Order ID to cancel
 * 
 * Redirects to cancel page
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const orderId = searchParams.get("order_id");

    if (orderId) {
      // Update order status to canceled
      try {
        await updateOrderStatus(orderId, "canceled");
      } catch (error) {
        // Log error but don't fail - order might already be processed
        console.error("Error updating order status:", error);
      }
    }

    // Redirect to cancel page
    const baseUrl =
      process.env.NEXT_PUBLIC_URL ||
      (request.headers.get("origin") || "http://localhost:3000");

    redirect(`${baseUrl}/checkout/cancel${orderId ? `?order_id=${orderId}` : ""}`);
  } catch (error) {
    console.error("Checkout cancel handler error:", error);

    const baseUrl =
      process.env.NEXT_PUBLIC_URL ||
      (request.headers.get("origin") || "http://localhost:3000");

    redirect(`${baseUrl}/checkout/cancel`);
  }
}


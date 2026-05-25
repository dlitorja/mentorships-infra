import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";

function getBaseUrl(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_URL ||
    (request.headers.get("origin") || "http://localhost:3000")
  );
}

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
  const searchParams = request.nextUrl.searchParams;
  const orderId = searchParams.get("order_id");
  const baseUrl = getBaseUrl(request);

  try {
    // Public cancel: proceed without authentication

    if (orderId) {
      // Update order status to canceled only if it's still pending
      try {
        const convex = getConvexClient();
        const order = await convex.query(api.orders.getOrderByIdPublic, { id: orderId as Id<"orders"> });
        if (order && order.status === "pending") {
          await convex.mutation(api.orders.cancelOrder, { id: orderId as Id<"orders"> });
        }
      } catch (error) {
        // Log error but don't fail - order might already be processed
        console.error("Error canceling order:", error);
      }
    }

    // Use NextResponse.redirect to avoid redirect being caught by try/catch
    return NextResponse.redirect(
      new URL(
        `/checkout/cancel${orderId ? `?order_id=${encodeURIComponent(orderId)}` : ""}`,
        baseUrl
      )
    );
  } catch (error) {
    console.error("Checkout cancel handler error:", error);

    return NextResponse.redirect(new URL("/checkout/cancel", baseUrl));
  }
}

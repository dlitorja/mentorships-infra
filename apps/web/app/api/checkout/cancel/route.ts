import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
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
  try {
    const searchParams = request.nextUrl.searchParams;
    const orderId = searchParams.get("order_id");

    if (orderId) {
      // Update order status to canceled via Convex
      try {
        const convex = getConvexClient();
        await convex.mutation(api.orders.cancelOrder, {
          id: orderId as Id<"orders">,
        });
      } catch (error) {
        // Log error but don't fail - order might already be processed
        console.error("Error canceling order:", error);
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


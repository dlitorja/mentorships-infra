import { NextRequest, NextResponse } from "next/server";
import { convexServerCall } from "@/lib/convex-server-call";

/**
 * GET /api/checkout/status?order_id=<convex order id>
 *
 * Returns the aggregate fulfilment state for an order so the success page can
 * report what actually happened instead of trusting the provider redirect.
 *
 * Auth model: capability token. The Convex order id is unguessable, and this
 * route returns no personally identifying data (no email, no Clerk id). The
 * response is safe to render to whoever holds the link, which is exactly who
 * the buyer is when they land back from Stripe or PayPal.
 *
 * `Cache-Control: no-store` matters: an intermediate cache could otherwise
 * serve a stale "pending" state for the whole poll loop.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const orderId = req.nextUrl.searchParams.get("order_id");

  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  try {
    const status = await convexServerCall<Record<string, unknown> | null>(
      "/orders/checkout-status",
      { id: orderId }
    );

    if (!status) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Checkout status lookup failed:", error);
    return NextResponse.json(
      { error: "Unable to read checkout status" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

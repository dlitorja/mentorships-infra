import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@mentorships/db";
import { stripe } from "@/lib/stripe";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Require authentication
    const userId = await requireAuth();

    const sessionId = req.nextUrl.searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    // Retrieve Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Authorize: verify user owns this session
    const sessionUserId = session.metadata?.user_id;
    if (sessionUserId && sessionUserId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized access to this session" },
        { status: 403 }
      );
    }

    // Note: Idempotency checks should be implemented downstream
    // when processing payments to prevent duplicate operations

    return NextResponse.json({
      verified: session.payment_status === "paid",
      session: {
        id: session.id,
        payment_status: session.payment_status,
        amount_total: session.amount_total,
        currency: session.currency,
      },
    });
  } catch (error) {
    console.error("Error verifying session:", error);
    return NextResponse.json(
      { error: "Failed to verify session" },
      { status: 500 }
    );
  }
}


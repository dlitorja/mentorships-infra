import { NextRequest, NextResponse } from "next/server";
import {
  verifyWebhookSignature,
  getWebhookSecret,
  isCheckoutSessionCompletedEvent,
  isChargeRefundedEvent,
} from "@mentorships/payments";
import {
  updateOrderStatus,
  getOrderById,
  createSessionPack,
  reserveSeat,
  getProductById,
  updateSessionPackStatus,
  releaseSeatByPackId,
  createPayment,
} from "@mentorships/db";
import type Stripe from "stripe";

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 * 
 * This endpoint processes:
 * - checkout.session.completed: Create session pack and seat reservation
 * - charge.refunded: Release seat and mark pack as refunded
 * 
 * Note: This endpoint is public (no auth required) but webhook signature is verified
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(body, signature, getWebhookSecret());
    } catch (error) {
      console.error("Webhook signature verification failed:", error);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    // Handle different event types
    if (isCheckoutSessionCompletedEvent(event)) {
      return await handleCheckoutSessionCompleted(event);
    }

    if (isChargeRefundedEvent(event)) {
      return await handleChargeRefunded(event);
    }

    // Unknown event type - log but don't error
    console.log(`Unhandled webhook event type: ${event.type}`);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/**
 * Handle checkout.session.completed event
 * Creates session pack and seat reservation
 */
async function handleCheckoutSessionCompleted(
  event: Stripe.Event & { data: { object: Stripe.Checkout.Session } }
): Promise<NextResponse> {
  const session = event.data.object;

  // Extract metadata
  const metadata = session.metadata;
  if (!metadata || !metadata.orderId || !metadata.userId || !metadata.mentorId) {
    console.error("Missing required metadata in checkout session:", session.id);
    return NextResponse.json(
      { error: "Missing required metadata" },
      { status: 400 }
    );
  }

  const { orderId, userId, mentorId, productId } = metadata;

  // Check if order exists and is still pending (idempotency check)
  const order = await getOrderById(orderId);
  if (!order) {
    console.error(`Order ${orderId} not found for session ${session.id}`);
    return NextResponse.json(
      { error: "Order not found" },
      { status: 404 }
    );
  }

  // If order is already paid, this is a duplicate webhook (idempotency)
  if (order.status === "paid") {
    console.log(`Order ${orderId} already processed, ignoring duplicate webhook`);
    return NextResponse.json({ received: true, message: "Order already processed" });
  }

  // Get product to get validity days and sessions per pack
  let validityDays = 30; // Default
  let sessionsPerPack = 4; // Default
  if (productId) {
    const product = await getProductById(productId);
    if (product) {
      validityDays = product.validityDays;
      sessionsPerPack = product.sessionsPerPack;
    }
  }

  // Calculate expiration date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + validityDays);

  // Get amount from session (convert from cents to dollars)
  const amountInDollars = (session.amount_total || 0) / 100;
  const amountString = amountInDollars.toFixed(2);

  // Create payment record
  const payment = await createPayment(
    orderId,
    "stripe",
    session.payment_intent as string,
    amountString,
    session.currency || "usd",
    "completed"
  );

  // Create session pack
  const sessionPack = await createSessionPack(
    userId,
    mentorId,
    payment.id,
    expiresAt,
    sessionsPerPack
  );

  // Reserve seat
  await reserveSeat(
    mentorId,
    userId,
    sessionPack.id,
    expiresAt // Seat expires when pack expires
  );

  // Update order status to paid
  await updateOrderStatus(orderId, "paid");

  console.log(
    `Successfully processed checkout for order ${orderId}, created pack ${sessionPack.id}`
  );

  return NextResponse.json({
    received: true,
    orderId,
    sessionPackId: sessionPack.id,
  });
}

/**
 * Handle charge.refunded event
 * Releases seat and marks pack as refunded
 */
async function handleChargeRefunded(
  event: Stripe.Event & { data: { object: Stripe.Charge } }
): Promise<NextResponse> {
  const charge = event.data.object;

  // Find order by payment intent ID
  // Note: In production, you should store payment_intent_id in payments table
  // For now, we'll need to find the order through metadata or payment records

  // TODO: Implement refund handling
  // This requires:
  // 1. Finding the order/payment by charge.payment_intent
  // 2. Finding the associated session pack
  // 3. Releasing the seat
  // 4. Marking pack as refunded

  console.log(`Charge refunded: ${charge.id}, payment_intent: ${charge.payment_intent}`);

  // For now, return success
  // This will be implemented when we have payment records linked properly
  return NextResponse.json({
    received: true,
    message: "Refund handling not yet fully implemented",
  });
}


import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { inngest } from "@/inngest/client";
import { stripe } from "@/lib/stripe";
import { reportError, reportInfo } from "@/lib/observability";

/**
 * Webhook handler that verifies Stripe signatures and sends events to Inngest
 * Inngest handles all processing with automatic retries, idempotency, and error handling
 */

export async function POST(req: NextRequest) {
  // Validate environment variable at runtime
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    await reportError({
      source: "webhooks/stripe",
      error: new Error("STRIPE_WEBHOOK_SECRET environment variable is not set"),
      message: "Webhook configuration error",
      level: "error",
    });
    return NextResponse.json(
      { error: "Webhook configuration error" },
      { status: 500 }
    );
  }
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature (CRITICAL for security!)
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    await reportError({
      source: "webhooks/stripe",
      error: err,
      message: "Webhook signature verification failed",
      level: "error",
      context: { signature: signature?.slice(0, 20) + "..." },
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Validate required metadata
        const orderId = session.metadata?.order_id;
        const userId = session.metadata?.user_id;
        const packId = session.metadata?.pack_id;

        if (!orderId || !userId || !packId) {
          await reportError({
            source: "webhooks/stripe",
            error: new Error("Missing required metadata in checkout session"),
            message: "Missing required metadata in checkout session",
            level: "error",
            context: { orderId, userId, packId, sessionId: session.id },
          });
          return NextResponse.json(
            { error: "Missing required metadata" },
            { status: 400 }
          );
        }

        // Send event to Inngest for processing
        // Inngest will handle retries, idempotency, and error recovery
        await inngest.send({
          name: "stripe/checkout.session.completed",
          data: {
            sessionId: session.id,
            orderId,
            userId,
            packId,
          },
        });

        await reportInfo({
          source: "webhooks/stripe",
          message: `Sent checkout.session.completed event to Inngest for order ${orderId}`,
          context: { orderId, sessionId: session.id },
        });
        return NextResponse.json({ received: true, eventId: event.id });
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string;

        if (!paymentIntentId) {
          await reportError({
            source: "webhooks/stripe",
            error: new Error("Missing payment_intent in charge refund event"),
            message: "Missing payment_intent in charge refund event",
            level: "error",
            context: { chargeId: charge.id },
          });
          return NextResponse.json(
            { error: "Missing payment_intent" },
            { status: 400 }
          );
        }

        // Send event to Inngest for processing
        await inngest.send({
          name: "stripe/charge.refunded",
          data: {
            chargeId: charge.id,
            paymentIntentId,
          },
        });

        await reportInfo({
          source: "webhooks/stripe",
          message: `Sent charge.refunded event to Inngest for charge ${charge.id}`,
          context: { chargeId: charge.id, paymentIntentId },
        });
        return NextResponse.json({ received: true, eventId: event.id });
      }

      default:
        await reportInfo({
          source: "webhooks/stripe",
          message: `Unhandled event type: ${event.type}`,
          context: { eventType: event.type, eventId: event.id },
        });
        return NextResponse.json({ received: true });
    }
  } catch (error) {
    await reportError({
      source: "webhooks/stripe",
      error,
      message: "Webhook processing error",
      level: "error",
      context: { eventType: event?.type },
    });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

// Disable body parsing (Stripe needs raw body)
export const runtime = "nodejs";

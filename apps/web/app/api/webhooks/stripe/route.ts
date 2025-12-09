import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { stripe } from "@/lib/stripe";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

/**
 * Webhook handler that verifies Stripe signatures and sends events to Inngest
 * Inngest handles all processing with automatic retries, idempotency, and error handling
 */

export async function POST(req: NextRequest) {
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
    console.error("Webhook signature verification failed:", err);
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
          console.error("Missing required metadata in checkout session", {
            orderId,
            userId,
            packId,
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

        console.log(`Sent checkout.session.completed event to Inngest for order ${orderId}`);
        return NextResponse.json({ received: true, eventId: event.id });
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string;

        if (!paymentIntentId) {
          console.error("Missing payment_intent in charge refund event");
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

        console.log(`Sent charge.refunded event to Inngest for charge ${charge.id}`);
        return NextResponse.json({ received: true, eventId: event.id });
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
        return NextResponse.json({ received: true });
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

// Disable body parsing (Stripe needs raw body)
export const runtime = "nodejs";


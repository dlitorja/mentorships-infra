import type Stripe from "stripe";
import type { Env } from "../../lib/env";
import { createInngestClient } from "../../lib/inngest";
import { createStripeWebhookVerifier } from "../../lib/stripe";
import { logError, logInfo } from "../../lib/observability";

/**
 * POST /webhooks/stripe
 * Worker-side port of apps/platform/app/api/webhooks/stripe/route.ts.
 * Verifies Stripe signature and forwards checkout/refund events to Inngest.
 */
export async function handleStripeWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  const source = "webhooks/stripe";

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logError(source, new Error("STRIPE_WEBHOOK_SECRET is not set"), "Webhook configuration error");
    return json({ error: "Webhook configuration error" }, 500);
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return json({ error: "No signature" }, 400);
  }

  const stripe = createStripeWebhookVerifier();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logError(source, err, "Webhook signature verification failed", {
      signature: signature.slice(0, 20) + "...",
    });
    return json({ error: "Invalid signature" }, 400);
  }

  const inngest = createInngestClient(env);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        const userId = session.metadata?.user_id;
        const packId = session.metadata?.pack_id;
        const studentEmail = session.customer_details?.email || undefined;

        if (!orderId || !userId || !packId) {
          if (event.livemode) {
            logError(source, new Error("Missing required metadata in live mode checkout session"), "Missing required metadata - returning 400 for retry", {
              orderId,
              userId,
              packId,
              sessionId: session.id,
            });
            return json({ error: "Missing required metadata" }, 400);
          }
          logError(source, new Error("Missing required metadata in test mode checkout session"), "Missing required metadata - skipping processing", {
            orderId,
            userId,
            packId,
            sessionId: session.id,
          });
          return json({ received: true, skipped: "missing_metadata" });
        }

        await inngest.send({
          name: "stripe/checkout.session.completed",
          data: {
            sessionId: session.id,
            orderId,
            userId,
            packId,
            studentEmail,
          },
        });

        logInfo(source, `Sent checkout.session.completed event to Inngest for order ${orderId}`, {
          orderId,
          sessionId: session.id,
          studentEmail,
        });
        return json({ received: true, eventId: event.id });
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const rawPaymentIntent = charge.payment_intent;
        const paymentIntentId =
          typeof rawPaymentIntent === "string" ? rawPaymentIntent : rawPaymentIntent?.id ?? null;

        if (!paymentIntentId) {
          if (event.livemode) {
            logError(source, new Error("Missing payment_intent in live mode charge refund event"), "Missing payment_intent - returning 400 for retry", {
              chargeId: charge.id,
            });
            return json({ error: "Missing payment_intent" }, 400);
          }
          logError(source, new Error("Missing payment_intent in test mode charge refund event"), "Missing payment_intent - skipping processing", {
            chargeId: charge.id,
          });
          return json({ received: true, skipped: "missing_payment_intent" });
        }

        await inngest.send({
          name: "stripe/charge.refunded",
          data: {
            chargeId: charge.id,
            paymentIntentId,
          },
        });

        logInfo(source, `Sent charge.refunded event to Inngest for charge ${charge.id}`, {
          chargeId: charge.id,
          paymentIntentId,
        });
        return json({ received: true, eventId: event.id });
      }

      default:
        logInfo(source, `Unhandled event type: ${event.type}`, {
          eventType: event.type,
          eventId: event.id,
        });
        return json({ received: true });
    }
  } catch (error) {
    logError(source, error, "Webhook processing error", {
      eventType: event.type,
    });
    return json({ error: "Webhook processing failed" }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

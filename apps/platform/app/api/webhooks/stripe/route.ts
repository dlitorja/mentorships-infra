import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { inngest } from "@/inngest/client";
import { stripe } from "@/lib/stripe";
import { reportError, reportInfo } from "@/lib/observability";

/**
 * Returns true only for a non-production deployment.
 *
 * The Stripe test bypass must never be reachable from production: a leaked
 * shared key would let a caller forge `checkout.session.completed` (creating a
 * paid order, pack, seat, inventory decrement, and onboarding emails) or
 * `charge.refunded` without a valid Stripe signature. The previous
 * implementation deliberately skipped this check and relied on a plan-doc
 * assertion that the flag was unset in production; nothing enforced it.
 */
function isNonProductionDeployment(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL_ENV !== "production"
  );
}

/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events for payment processing.
 * Processes checkout.session.completed (creates session pack) and
 * charge.refunded (triggers refund flow) events. Verifies webhook
 * signature before processing. Events are dispatched to Inngest
 * for async processing. The test bypass is available only on
 * non-production deployments and requires both the flag and the
 * shared key.
 */
export async function POST(req: NextRequest) {
  // Test bypass for CI and integration tests.
  // Requires TEST_WEBHOOK_BYPASS=true, a configured TEST_WEBHOOK_BYPASS_KEY,
  // BOTH headers (x-test-bypass: 1, x-test-bypass-key), and a non-production
  // deployment. Any of those missing falls through to signature verification.
  if (
    isNonProductionDeployment() &&
    process.env.TEST_WEBHOOK_BYPASS === "true" &&
    typeof process.env.TEST_WEBHOOK_BYPASS_KEY === "string" &&
    process.env.TEST_WEBHOOK_BYPASS_KEY.length > 0 &&
    req.headers.get("x-test-bypass") === "1" &&
    req.headers.get("x-test-bypass-key") === process.env.TEST_WEBHOOK_BYPASS_KEY
  ) {
    try {
      const payload = await req.json();
      const type: string | undefined = (payload && payload.type) || undefined;

      if (type === "checkout.session.completed") {
        const session = payload.data?.object;
        const orderId = session?.metadata?.order_id;
        const userId = session?.metadata?.user_id;
        const packId = session?.metadata?.pack_id;
        const sessionId = session?.id;
        if (!orderId || !userId || !packId || !sessionId) {
          return NextResponse.json(
            { received: true, bypass: true, skipped: "missing_metadata" },
            { status: 200 }
          );
        }
        await inngest.send({
          name: "stripe/checkout.session.completed",
          data: { sessionId, orderId, userId, packId },
        });
        return NextResponse.json({ received: true, bypass: true });
      }

      if (type === "charge.refunded") {
        const charge = payload.data?.object;
        const paymentIntentId = charge?.payment_intent;
        const chargeId = charge?.id;
        if (!paymentIntentId) {
          return NextResponse.json(
            { received: true, bypass: true, skipped: "missing_payment_intent" },
            { status: 200 }
          );
        }
        if (!chargeId) {
          return NextResponse.json({ error: "Missing charge id in bypass payload" }, { status: 400 });
        }
        await inngest.send({
          name: "stripe/charge.refunded",
          data: {
            chargeId,
            paymentIntentId,
            // Cumulative refunded amount in cents when the caller supplies it;
            // downstream treats `undefined` as "full refund" for backward
            // compatibility with older test payloads.
            amountRefunded:
              typeof payload?.data?.object?.amount_refunded === "number"
                ? payload.data.object.amount_refunded
                : undefined,
            chargeAmount:
              typeof payload?.data?.object?.amount === "number"
                ? payload.data.object.amount
                : undefined,
          },
        });
        return NextResponse.json({ received: true, bypass: true });
      }

      return NextResponse.json({ received: true, bypass: true, message: "Unhandled event type" });
    } catch (err) {
      await reportError({
        source: "webhooks/stripe",
        error: err,
        message: "Bypass processing error",
        level: "error",
      });
      return NextResponse.json({ error: "Bypass failed" }, { status: 500 });
    }
  }

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

        const orderId = session.metadata?.order_id;
        const userId = session.metadata?.user_id;
        const packId = session.metadata?.pack_id;
        const studentEmail = session.customer_details?.email || undefined;

        if (!orderId || !userId || !packId) {
          if (event.livemode) {
            await reportError({
              source: "webhooks/stripe",
              error: new Error("Missing required metadata in live mode checkout session"),
              message: "Missing required metadata in checkout session - returning 400 for retry",
              level: "error",
              context: { orderId, userId, packId, sessionId: session.id },
            });
            return NextResponse.json(
              { error: "Missing required metadata" },
              { status: 400 }
            );
          }
          await reportError({
            source: "webhooks/stripe",
            error: new Error("Missing required metadata in test mode checkout session"),
            message: "Missing required metadata in checkout session - skipping processing",
            level: "warn",
            context: { orderId, userId, packId, sessionId: session.id },
          });
          return NextResponse.json(
            { received: true, skipped: "missing_metadata" },
            { status: 200 }
          );
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

        await reportInfo({
          source: "webhooks/stripe",
          message: `Sent checkout.session.completed event to Inngest for order ${orderId}`,
          context: { orderId, sessionId: session.id, studentEmail },
        });
        return NextResponse.json({ received: true, eventId: event.id });
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const rawPaymentIntent = charge.payment_intent;
        const paymentIntentId =
          typeof rawPaymentIntent === "string" ? rawPaymentIntent : rawPaymentIntent?.id ?? null;

        if (!paymentIntentId) {
          if (event.livemode) {
            await reportError({
              source: "webhooks/stripe",
              error: new Error("Missing payment_intent in live mode charge refund event"),
              message: "Missing payment_intent in charge refund event - returning 400 for retry",
              level: "error",
              context: { chargeId: charge.id },
            });
            return NextResponse.json(
              { error: "Missing payment_intent" },
              { status: 400 }
            );
          }
          await reportError({
            source: "webhooks/stripe",
            error: new Error("Missing payment_intent in test mode charge refund event"),
            message: "Missing payment_intent in charge refund event - skipping processing",
            level: "warn",
            context: { chargeId: charge.id },
          });
          return NextResponse.json(
            { received: true, skipped: "missing_payment_intent" },
            { status: 200 }
          );
        }

        await inngest.send({
          name: "stripe/charge.refunded",
          data: {
            chargeId: charge.id,
            paymentIntentId,
            // `amount_refunded` on the charge is CUMULATIVE (all refunds to
            // date), not the delta for this event. Downstream diffs it against
            // the amount already recorded on the payment.
            amountRefunded: charge.amount_refunded,
            chargeAmount: charge.amount,
          },
        });

        await reportInfo({
          source: "webhooks/stripe",
          message: `Sent charge.refunded event to Inngest for charge ${charge.id}`,
          context: { chargeId: charge.id, paymentIntentId },
        });
        return NextResponse.json({ received: true, eventId: event.id });
      }

      case "charge.refund.updated": {
        // A refund's status can change after creation (pending → succeeded,
        // or → failed/canceled). We do not act on the Refund object itself:
        // we re-read the parent charge so the cumulative `amount_refunded`
        // stays the single source of truth, and re-emit the same event the
        // `charge.refunded` handler uses. The downstream handler is
        // idempotent on the cumulative amount, so re-delivery is safe.
        const refund = event.data.object as Stripe.Refund;
        if (refund.status !== "succeeded") {
          return NextResponse.json({ received: true, ignored: refund.status });
        }

        const chargeId =
          typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
        if (!chargeId) {
          return NextResponse.json({ received: true, skipped: "missing_charge" });
        }

        const charge = await stripe.charges.retrieve(chargeId);
        const rawPaymentIntent = charge.payment_intent;
        const paymentIntentId =
          typeof rawPaymentIntent === "string"
            ? rawPaymentIntent
            : rawPaymentIntent?.id ?? null;

        if (!paymentIntentId) {
          return NextResponse.json({ received: true, skipped: "missing_payment_intent" });
        }

        await inngest.send({
          name: "stripe/charge.refunded",
          data: {
            chargeId: charge.id,
            paymentIntentId,
            amountRefunded: charge.amount_refunded,
            chargeAmount: charge.amount,
          },
        });

        await reportInfo({
          source: "webhooks/stripe",
          message: `Re-emitted cumulative refund for charge ${charge.id}`,
          context: { chargeId: charge.id, paymentIntentId, refundId: refund.id },
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

export const runtime = "nodejs";

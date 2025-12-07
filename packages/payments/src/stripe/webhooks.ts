import type Stripe from "stripe";
import { getStripeClient } from "./client";
import type { ParsedStripeEvent } from "./types";

/**
 * Verify Stripe webhook signature
 * 
 * This is CRITICAL for security - always verify webhook signatures
 * before processing webhook events.
 * 
 * @param body - Raw request body as string
 * @param signature - Stripe signature header
 * @param webhookSecret - Stripe webhook secret (whsec_...)
 * @returns Verified Stripe event
 * @throws Error if signature verification fails
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  const stripe = getStripeClient();

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );
    return event;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Webhook signature verification failed: ${error.message}`);
    }
    throw new Error("Webhook signature verification failed");
  }
}

/**
 * Get webhook secret from environment
 * 
 * @returns Webhook secret
 * @throws Error if STRIPE_WEBHOOK_SECRET is not set
 */
export function getWebhookSecret(): string {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET environment variable is required. " +
      "Get it from Stripe Dashboard → Developers → Webhooks → Select endpoint → Signing secret"
    );
  }

  return webhookSecret;
}

/**
 * Parse webhook event and extract metadata
 * 
 * @param event - Stripe webhook event
 * @returns Parsed event with metadata
 */
export function parseWebhookEvent(
  event: Stripe.Event
): ParsedStripeEvent | null {
  // Extract metadata from event data
  let metadata: Record<string, string> | null | undefined;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    metadata = session.metadata || null;
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    metadata = charge.metadata || null;
  }

  if (!metadata) {
    return null;
  }

  // Convert metadata to Record<string, string>
  const metadataRecord: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      metadataRecord[key] = value;
    }
  }

  return {
    id: event.id,
    type: event.type,
    data: event.data,
    created: event.created,
    livemode: event.livemode,
    metadata: metadataRecord,
  };
}

/**
 * Type guard to check if event is a checkout.session.completed event
 */
export function isCheckoutSessionCompletedEvent(
  event: Stripe.Event
): event is Stripe.Event & { data: { object: Stripe.Checkout.Session } } {
  return event.type === "checkout.session.completed";
}

/**
 * Type guard to check if event is a charge.refunded event
 */
export function isChargeRefundedEvent(
  event: Stripe.Event
): event is Stripe.Event & { data: { object: Stripe.Charge } } {
  return event.type === "charge.refunded";
}


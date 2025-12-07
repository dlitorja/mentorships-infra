import type Stripe from "stripe";

/**
 * Metadata to include in Stripe checkout session
 * These values are passed through webhooks for pack creation
 */
export interface CheckoutSessionMetadata {
  userId: string; // Clerk user ID
  mentorId: string; // Mentor UUID
  productId?: string; // Mentorship product UUID (optional)
  orderId?: string; // Order UUID (optional, if order created before checkout)
}

/**
 * Result of creating a checkout session
 */
export interface CheckoutSessionResult {
  sessionId: string;
  url: string; // Redirect URL for customer
}

/**
 * Webhook event types we handle
 */
export type StripeWebhookEventType =
  | "checkout.session.completed"
  | "charge.refunded"
  | "payment_intent.succeeded"
  | "payment_intent.payment_failed";

/**
 * Extended Stripe event with parsed metadata
 */
export interface ParsedStripeEvent {
  id: string;
  type: Stripe.Event.Type;
  data: Stripe.Event.Data;
  created: number;
  livemode: boolean;
  metadata: Record<string, string>;
}


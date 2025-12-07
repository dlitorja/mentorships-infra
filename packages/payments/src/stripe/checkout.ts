import type Stripe from "stripe";
import { getStripeClient } from "./client";
import type { CheckoutSessionMetadata, CheckoutSessionResult } from "./types";

/**
 * Create a Stripe Checkout session for a one-time payment
 * 
 * @param priceId - Stripe Price ID (e.g., price_1234567890)
 * @param metadata - Metadata to include in session (userId, mentorId, etc.)
 * @param successUrl - URL to redirect after successful payment
 * @param cancelUrl - URL to redirect if payment is canceled
 * @returns Checkout session with redirect URL
 */
export async function createCheckoutSession(
  priceId: string,
  metadata: CheckoutSessionMetadata,
  successUrl: string,
  cancelUrl: string
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "payment", // One-time payment (not subscription)
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      userId: metadata.userId,
      mentorId: metadata.mentorId,
      ...(metadata.productId && { productId: metadata.productId }),
      ...(metadata.orderId && { orderId: metadata.orderId }),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Allow customer to enter email
    customer_email: undefined, // Will be collected by Stripe Checkout
    // Expire checkout session after 24 hours
    expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  });

  if (!session.url) {
    throw new Error("Failed to create checkout session URL");
  }

  return {
    sessionId: session.id,
    url: session.url,
  };
}

/**
 * Retrieve a checkout session by ID
 * 
 * @param sessionId - Stripe checkout session ID
 * @returns Checkout session object
 */
export async function getCheckoutSession(
  sessionId: string
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent", "customer"],
  });

  return session;
}

/**
 * Get metadata from a checkout session
 * 
 * @param session - Stripe checkout session
 * @returns Parsed metadata or null if missing required fields
 */
export function parseCheckoutSessionMetadata(
  session: Stripe.Checkout.Session
): CheckoutSessionMetadata | null {
  const metadata = session.metadata;

  if (!metadata || !metadata.userId || !metadata.mentorId) {
    return null;
  }

  return {
    userId: metadata.userId,
    mentorId: metadata.mentorId,
    productId: metadata.productId,
    orderId: metadata.orderId,
  };
}


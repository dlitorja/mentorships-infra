import Stripe from "stripe";

/**
 * Get or create Stripe client instance
 * 
 * Validates that STRIPE_SECRET_KEY is set and returns configured Stripe client
 * 
 * @returns Configured Stripe client instance
 * @throws Error if STRIPE_SECRET_KEY is not set
 */
export function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY environment variable is required. " +
      "Please set it in your .env.local file."
    );
  }

  return new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });
}

/**
 * Get Stripe publishable key from environment
 * 
 * @returns Stripe publishable key
 * @throws Error if NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set
 */
export function getStripePublishableKey(): string {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable is required. " +
      "Please set it in your .env.local file."
    );
  }

  return publishableKey;
}


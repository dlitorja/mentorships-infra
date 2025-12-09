import Stripe from "stripe";

/**
 * Validate and get Stripe secret key
 */
function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Please configure it in your environment variables."
    );
  }
  // Basic validation - should start with sk_test_ or sk_live_
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) {
    throw new Error(
      "STRIPE_SECRET_KEY appears to be invalid. It should start with 'sk_test_' or 'sk_live_'."
    );
  }
  return key;
}

/**
 * Shared Stripe client instance
 * Initialized once and reused across the application
 */
export const stripe = new Stripe(getStripeSecretKey(), {
  apiVersion: "2024-12-18.acacia",
});


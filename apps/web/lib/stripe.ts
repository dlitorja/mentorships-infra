import Stripe from "stripe";

let _stripeInstance: Stripe | null = null;

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Please configure it in your environment variables."
    );
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) {
    throw new Error(
      "STRIPE_SECRET_KEY appears to be invalid. It should start with 'sk_test_' or 'sk_live_'."
    );
  }
  return key;
}

export const getStripe = () => {
  if (!_stripeInstance) {
    _stripeInstance = new Stripe(getStripeSecretKey(), {
      apiVersion: "2025-02-24.acacia",
    });
  }
  return _stripeInstance;
};

// Lazy-load Stripe - only initializes when actually used
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripe()[prop as keyof Stripe];
  },
});
import Stripe from "stripe";

export function createStripeWebhookVerifier(): Pick<Stripe, "webhooks"> {
  // No API key is required for webhook signature verification; only the
  // webhook secret is used. Stripe still requires a non-empty string for the
  // constructor, so we pass a placeholder.
  return new Stripe("pk_worker_webhook_only", {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });
}

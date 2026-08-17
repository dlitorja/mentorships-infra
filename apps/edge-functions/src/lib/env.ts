export interface Env {
  // Stripe webhook verification
  STRIPE_WEBHOOK_SECRET: string;

  // Inngest event publishing
  INNGEST_EVENT_KEY: string;
  INNGEST_APP_ID?: string;

  // PayPal webhook verification and API access
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_WEBHOOK_ID: string;
  PAYPAL_MODE?: string; // "live" or "sandbox"; defaults to "sandbox"

  // Convex HTTP action invocation for Daily.co recording webhooks
  CONVEX_URL: string;
}

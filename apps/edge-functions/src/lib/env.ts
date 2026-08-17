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

  // Convex HTTP action invocation for Daily.co recording webhooks and share links
  CONVEX_URL: string;

  // Turnstile verification
  TURNSTILE_SECRET_KEY: string;

  // Backblaze B2 (S3-compatible) presigned URLs
  B2_ENDPOINT: string;
  B2_ACCESS_KEY_ID: string;
  B2_SECRET_ACCESS_KEY: string;
  B2_BUCKET_NAME: string;
  B2_REGION?: string;

  // CORS origins for cross-origin browser requests (e.g. Huckleberry Drive share link downloads)
  ALLOWED_ORIGINS?: string;
}

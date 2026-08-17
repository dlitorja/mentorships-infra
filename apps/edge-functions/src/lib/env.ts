export interface Env {
  // Stripe webhook verification
  STRIPE_WEBHOOK_SECRET: string;

  // Inngest event publishing
  INNGEST_EVENT_KEY: string;
  INNGEST_APP_ID?: string;
}

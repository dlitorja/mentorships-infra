#!/usr/bin/env tsx
/**
 * Create Stripe Webhook Endpoint (Test Mode)
 *
 * Uses the Stripe API to create a webhook endpoint for the dev deployment and
 * prints the signing secret (whsec_...). If an endpoint for the same URL
 * already exists, this script will refuse to create a duplicate and will tell
 * you the existing endpoint id. Secrets are only returned on creation; Stripe
 * does not return the secret when listing/fetching endpoints.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm tsx scripts/create-stripe-webhook.ts [baseUrl]
 *   # Example:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm tsx scripts/create-stripe-webhook.ts https://dev.mentorships.huckleberry.art
 */

import Stripe from "stripe";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is required in the environment");
    process.exit(1);
  }

  const baseUrlArg = process.argv[2];
  const baseUrl = (baseUrlArg || process.env.NEXT_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${baseUrl}/api/webhooks/stripe`;

  const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });

  // Check for existing endpoint with the same URL
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = existing.data.find((ep) => ep.url === url && !ep.deleted);
  if (match) {
    console.log(`An endpoint already exists for ${url}`);
    console.log(`Endpoint ID: ${match.id}`);
    console.log("Note: Stripe only returns the signing secret at creation time. To rotate, create a new endpoint.");
    process.exit(0);
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: [
      "checkout.session.completed",
      "charge.refunded",
    ],
  });

  // Secret is only returned on creation
  // @ts-expect-error: secret is present on creation response
  const secret: string | undefined = (created as any).secret;
  console.log("Created webhook endpoint:");
  console.log(`  ID: ${created.id}`);
  console.log(`  URL: ${created.url}`);
  if (secret) {
    console.log(`  Signing secret: ${secret}`);
  } else {
    console.log("  Signing secret not present in response; create action may have been suppressed by Stripe");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

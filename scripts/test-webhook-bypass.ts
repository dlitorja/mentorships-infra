#!/usr/bin/env tsx
/**
 * Webhook Bypass Test
 *
 * Sends a synthetic checkout.session.completed event to the platform webhook
 * using the dev bypass header. This validates that the webhook route accepts
 * the bypass and emits an Inngest event without requiring a valid Stripe
 * signature or existing Convex data.
 *
 * Requirements (on the target deployment):
 * - TEST_WEBHOOK_BYPASS=true
 *
 * Usage:
 *   pnpm tsx scripts/test-webhook-bypass.ts [baseUrl]
 *   # Example:
 *   pnpm tsx scripts/test-webhook-bypass.ts https://dev.mentorships.huckleberry.art
 */

const BASE_URL = (process.argv[2] || process.env.NEXT_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");

async function main() {
  const payload = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_bypass_" + Date.now(),
        metadata: {
          order_id: "order_test_bypass",
          user_id: "user_test_bypass",
          pack_id: "pack_test_bypass",
        },
        customer_details: {
          email: "test-bypass@example.com",
        },
      },
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-bypass": "1",
  };
  if (process.env.TEST_WEBHOOK_BYPASS_KEY) {
    headers["x-test-bypass-key"] = process.env.TEST_WEBHOOK_BYPASS_KEY;
  }

  const res = await fetch(`${BASE_URL}/api/webhooks/stripe`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(text);

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

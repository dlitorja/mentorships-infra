# @mentorships/payments

Payment processing package for the mentorship platform. Provides Stripe and PayPal adapters for one-time payments.

## Structure

```
src/
  stripe/
    client.ts      # Stripe client initialization
    checkout.ts    # Checkout session creation
    webhooks.ts    # Webhook verification
    refunds.ts     # Refund processing
    types.ts       # TypeScript types
  paypal/          # (To be implemented)
  index.ts         # Public exports
```

## Environment Variables

Required environment variables (set in `apps/web/.env.local`):

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # Get from Stripe Dashboard after webhook setup
```

## Usage

### Creating a Checkout Session

```typescript
import { createCheckoutSession } from "@mentorships/payments";

const { url } = await createCheckoutSession(
  "price_1234567890", // Stripe Price ID
  {
    userId: "user_...",
    mentorId: "mentor_uuid",
    productId: "product_uuid", // optional
  },
  "https://yourapp.com/success",
  "https://yourapp.com/cancel"
);

// Redirect user to url
```

### Verifying Webhooks

```typescript
import { verifyWebhookSignature, getWebhookSecret } from "@mentorships/payments";

const event = verifyWebhookSignature(
  requestBody,
  signatureHeader,
  getWebhookSecret()
);
```

### Processing Refunds

```typescript
import { createRefund, calculateRefundAmount } from "@mentorships/payments";

// Calculate refund amount (based on remaining sessions)
const refundAmount = calculateRefundAmount(
  4,    // totalSessions
  2,    // remainingSessions
  10000 // totalAmount in cents ($100.00)
);

// Create refund
const refund = await createRefund(
  paymentIntentId,
  refundAmount,
  "requested_by_customer"
);
```

## Development

### Testing

Use Stripe test mode for development:

1. Get test API keys from Stripe Dashboard (test mode)
2. Use Stripe CLI for webhook forwarding:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
3. Copy the webhook secret from CLI output to `.env.local`

### Test Cards

Stripe provides test cards for testing:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- 3D Secure: `4000 0025 0000 3155`

See [Stripe Testing Docs](https://stripe.com/docs/testing) for full list.


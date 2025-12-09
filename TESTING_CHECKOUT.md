# Testing Stripe Checkout Flow

## Prerequisites

1. ✅ Product created in database (Product ID: `24cfcc67-ff04-4d57-a702-b0e8c55bbb23`)
2. ✅ Stripe Price ID configured: `price_1SbNPUA4l1a5LDm782TSgPx6`
3. ⚠️ Environment variables need to be set in `apps/web/.env.local`

## Required Environment Variables

Make sure `apps/web/.env.local` has:

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # For webhook testing

# App URL
NEXT_PUBLIC_URL=http://localhost:3000

# Clerk (if not already set)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Supabase (if not already set)
NEXT_PUBLIC_SUPABASE_URL=https://ytxtlscmxyqomxhripki.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Testing Steps

### Step 1: Start the Development Server

```bash
cd apps/web
pnpm dev
```

Server should start on `http://localhost:3000`

### Step 2: Set Up Stripe Webhook Testing (Local)

In a separate terminal:

```bash
# Install Stripe CLI if not already installed
# macOS: brew install stripe/stripe-cli/stripe
# Or download from: https://stripe.com/docs/stripe-cli

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

**Copy the webhook secret** (starts with `whsec_...`) from the CLI output and add it to `.env.local` as `STRIPE_WEBHOOK_SECRET`.

### Step 3: Authenticate (Required)

The checkout endpoint requires authentication. You'll need to:

1. Visit `http://localhost:3000`
2. Sign in or create a test account (Clerk)
3. After sign-in, you'll be redirected to `/dashboard`

### Step 4: Test Checkout API

#### Option A: Using Browser DevTools

1. Open browser DevTools (F12)
2. Go to Console tab
3. Run this JavaScript:

```javascript
fetch('/api/checkout/stripe', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    productId: '24cfcc67-ff04-4d57-a702-b0e8c55bbb23'
  })
})
.then(res => res.json())
.then(data => {
  if (data.checkoutUrl) {
    console.log('✅ Checkout URL:', data.checkoutUrl);
    window.location.href = data.checkoutUrl; // Redirect to Stripe Checkout
  } else {
    console.error('❌ Error:', data);
  }
});
```

#### Option B: Using curl (requires auth token)

```bash
# Get your session token from browser cookies or use Clerk API
curl -X POST http://localhost:3000/api/checkout/stripe \
  -H "Content-Type: application/json" \
  -H "Cookie: __session=YOUR_SESSION_TOKEN" \
  -d '{
    "productId": "24cfcc67-ff04-4d57-a702-b0e8c55bbb23"
  }'
```

### Step 5: Complete Test Payment

1. You'll be redirected to Stripe Checkout
2. Use Stripe test card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/34)
   - CVC: Any 3 digits (e.g., 123)
   - ZIP: Any 5 digits (e.g., 12345)
3. Complete the payment
4. You'll be redirected back to `/checkout/success`

### Step 6: Verify Webhook Processing

Check your Stripe CLI terminal - you should see:
```
2025-12-06 16:10:00   --> checkout.session.completed [evt_xxx]
2025-12-06 16:10:00  <-- [200] POST http://localhost:3000/api/webhooks/stripe
```

### Step 7: Verify Database Records

Check that these were created:
- ✅ Order record (status: `paid`)
- ✅ Payment record (status: `completed`)
- ✅ Session pack record (status: `active`, remaining_sessions: `4`)
- ✅ Seat reservation (status: `active`)

You can check in Supabase Dashboard or run:

```sql
-- Check order
SELECT * FROM orders ORDER BY created_at DESC LIMIT 1;

-- Check payment
SELECT * FROM payments ORDER BY created_at DESC LIMIT 1;

-- Check session pack
SELECT * FROM session_packs ORDER BY created_at DESC LIMIT 1;

-- Check seat reservation
SELECT * FROM seat_reservations ORDER BY created_at DESC LIMIT 1;
```

## Expected Flow

1. **POST /api/checkout/stripe** → Returns `{ checkoutUrl: "https://checkout.stripe.com/..." }`
2. **Redirect to Stripe Checkout** → User completes payment
3. **Stripe sends webhook** → `checkout.session.completed`
4. **Webhook handler** → Creates order, payment, session pack, seat reservation
5. **Redirect to success page** → `/checkout/success?order_id=...`

## Troubleshooting

### Error: "Unauthorized"
- Make sure you're signed in to Clerk
- Check that authentication is working

### Error: "Product not found"
- Verify product ID is correct: `24cfcc67-ff04-4d57-a702-b0e8c55bbb23`
- Check product is active in database

### Error: "No seats available"
- Check mentor's `max_active_students` setting
- Check existing seat reservations

### Webhook not received
- Make sure Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Check `STRIPE_WEBHOOK_SECRET` matches the CLI output
- Check webhook endpoint is accessible

### Payment succeeded but no records created
- Check webhook logs in Stripe CLI
- Check server logs for errors
- Verify webhook signature verification passed

## Test Cards

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires 3D Secure**: `4000 0025 0000 3155`

More test cards: https://stripe.com/docs/testing


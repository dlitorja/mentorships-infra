# Manual Stripe Testing Guide

This guide covers manual testing procedures for scenarios that require:
- Authentication
- Database interactions
- Stripe CLI
- Real webhook events

---

## Prerequisites

1. **Development server running:**
   ```bash
   cd apps/web
   pnpm dev
   ```

2. **Stripe CLI installed and logged in:**
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Copy the webhook secret from CLI output to `.env.local` as `STRIPE_WEBHOOK_SECRET`

3. **Test data in database:**
   - A mentorship product with `stripePriceId` configured
   - A test user (Clerk account)

4. **Environment variables set:**
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - Clerk keys
   - Supabase keys

---

## High Priority Tests

### 1. Webhook Signature Verification ✅ (Automated)

Run the automated test:
```bash
pnpm tsx scripts/test-stripe-integration.ts webhook-signature
```

Or test manually:
```bash
# Test missing signature
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"type":"checkout.session.completed"}'
# Expected: 400 with "No signature" error

# Test invalid signature
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -H "stripe-signature: invalid_signature" \
  -d '{"type":"checkout.session.completed"}'
# Expected: 400 with "Invalid signature" error
```

---

### 2. Idempotency Tests

#### Test 2.1: Duplicate Webhook Events

**Steps:**
1. Complete a checkout flow (use test card `4242 4242 4242 4242`)
2. Wait for webhook to process (check Inngest dashboard)
3. Verify database records created:
   ```sql
   SELECT * FROM orders ORDER BY created_at DESC LIMIT 1;
   SELECT * FROM payments ORDER BY created_at DESC LIMIT 1;
   SELECT * FROM session_packs ORDER BY created_at DESC LIMIT 1;
   SELECT * FROM seat_reservations ORDER BY created_at DESC LIMIT 1;
   ```
4. **Replay the webhook event:**
   - In Stripe Dashboard → Developers → Events
   - Find the `checkout.session.completed` event
   - Click "Send test webhook" or use Stripe CLI:
     ```bash
     stripe events resend evt_xxxxx
     ```
5. **Verify no duplicates:**
   - Check database - should have same number of records
   - Check Inngest logs - should show idempotency check passed
   - Order status should remain "paid" (not processed again)

**Expected Result:** ✅ No duplicate records created

---

#### Test 2.2: Order Already Paid

**Steps:**
1. Complete a checkout
2. Manually set order status to "paid" in database:
   ```sql
   UPDATE orders SET status = 'paid' WHERE id = 'order-id';
   ```
3. Trigger webhook again (same as Test 2.1)
4. Check Inngest function logs

**Expected Result:** ✅ Function returns early with "Order already processed" message

---

#### Test 2.3: Payment Already Exists

**Steps:**
1. Complete a checkout
2. Note the payment ID from database
3. Manually trigger webhook again
4. Check Inngest logs - should find existing payment

**Expected Result:** ✅ Uses existing payment, doesn't create duplicate

---

### 3. Error Scenarios

#### Test 3.1: Invalid packId

**Steps:**
1. Authenticate (sign in via Clerk)
2. Call checkout API with invalid packId:
   ```javascript
   fetch('/api/checkout/stripe', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ packId: 'invalid-id-12345' })
   })
   ```

**Expected Result:** ✅ 404 error with "Pack not found"

---

#### Test 3.2: Pack Without stripePriceId

**Steps:**
1. Create a pack in database without `stripePriceId`:
   ```sql
   UPDATE mentorship_products SET stripe_price_id = NULL WHERE id = 'pack-id';
   ```
2. Try to checkout with that packId

**Expected Result:** ✅ 400 error with "Stripe price ID not configured"

---

#### Test 3.3: Missing Metadata in Webhook

**Steps:**
1. Create a checkout session manually in Stripe Dashboard (without metadata)
2. Complete payment
3. Webhook should be received

**Expected Result:** ✅ 400 error with "Missing required metadata"

---

#### Test 3.4: Stripe API Failure

**Steps:**
1. Temporarily set invalid `STRIPE_SECRET_KEY` in `.env.local`
2. Try to create checkout

**Expected Result:** ✅ Order marked as "failed", error returned

---

### 4. Refund Flow Tests

#### Test 4.1: Full Refund

**Steps:**
1. Complete a checkout
2. Wait for webhook processing
3. In Stripe Dashboard → Payments → Find payment → Refund
4. Verify webhook received (`charge.refunded`)
5. Check database:
   ```sql
   -- Check payment status
   SELECT * FROM payments WHERE id = 'payment-id';
   -- Expected: status = 'refunded', refunded_amount set
   
   -- Check order status
   SELECT * FROM orders WHERE id = 'order-id';
   -- Expected: status = 'refunded'
   
   -- Check session pack
   SELECT * FROM session_packs WHERE payment_id = 'payment-id';
   -- Expected: status = 'refunded', remaining_sessions = 0
   
   -- Check seat reservation
   SELECT * FROM seat_reservations WHERE session_pack_id = 'pack-id';
   -- Expected: status = 'released'
   ```

**Expected Result:** ✅ All records updated correctly, seat released

---

#### Test 4.2: Refund for Non-Existent Payment

**Steps:**
1. Create a fake refund webhook event (via Stripe CLI or dashboard)
2. Use a payment_intent that doesn't exist in database

**Expected Result:** ✅ Error logged, webhook returns 500 (Inngest will retry)

---

## Medium Priority Tests

### 5. Discount & Pricing Tests

#### Test 5.1: Grandfathered Pricing

**Prerequisites:**
- Set up grandfathered user configuration
- Create coupon in Stripe Dashboard
- Link coupon to grandfathered users

**Steps:**
1. Sign in as grandfathered user
2. Create checkout
3. Verify coupon auto-applied in Stripe Checkout
4. Complete payment
5. Check order record:
   ```sql
   SELECT original_amount, discount_amount, discount_code FROM orders WHERE id = 'order-id';
   ```

**Expected Result:** ✅ Discount applied, amounts tracked correctly

---

#### Test 5.2: Customer Promotion Code

**Steps:**
1. Create promotion code in Stripe Dashboard
2. Sign in as regular user (not grandfathered)
3. Create checkout (promotion code field should be available in Stripe Checkout UI)
4. Enter promotion code in Stripe Checkout
5. Complete payment
6. Verify discount in order record

**Expected Result:** ✅ Promotion code applied, discount tracked

---

#### Test 5.3: Customer Code Overrides Grandfathered

**Steps:**
1. Sign in as grandfathered user
2. Create checkout with customer-entered promotion code
3. Complete payment
4. Verify customer code was used (not grandfathered coupon)

**Expected Result:** ✅ Customer code takes precedence

---

### 6. Edge Cases

#### Test 6.1: Concurrent Checkout Requests

**Steps:**
1. Open two browser tabs
2. Start checkout in both simultaneously
3. Complete both payments

**Expected Result:** ✅ Both orders processed correctly, no conflicts

---

#### Test 6.2: Webhook Retry After Partial Failure

**Steps:**
1. Complete a checkout
2. Manually delete payment record from database (simulating failure)
3. Trigger webhook again
4. Check Inngest logs - should retry and recreate payment

**Expected Result:** ✅ Inngest retries and completes successfully

---

#### Test 6.3: 3D Secure Payment

**Steps:**
1. Use test card `4000 0025 0000 3155` (requires 3D Secure)
2. Complete checkout
3. Complete 3D Secure authentication
4. Verify webhook received after 3D Secure

**Expected Result:** ✅ Payment processed after 3D Secure

---

## Test Results Tracking

Use this checklist to track your test results:

```markdown
## Test Results

### High Priority
- [ ] Webhook signature verification
- [ ] Duplicate webhook events (idempotency)
- [ ] Order already paid check
- [ ] Payment already exists check
- [ ] Invalid packId error
- [ ] Pack without stripePriceId error
- [ ] Missing metadata error
- [ ] Stripe API failure handling
- [ ] Full refund flow
- [ ] Refund for non-existent payment

### Medium Priority
- [ ] Grandfathered pricing
- [ ] Customer promotion code
- [ ] Customer code overrides grandfathered
- [ ] Concurrent checkout requests
- [ ] Webhook retry after failure
- [ ] 3D Secure payment
```

---

## Troubleshooting

### Webhook Not Received
- Check Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Verify `STRIPE_WEBHOOK_SECRET` matches CLI output
- Check server logs for errors

### Inngest Function Not Executing
- Check Inngest Dashboard for function status
- Verify event was sent: Check webhook handler logs
- Check Inngest function logs for errors

### Database Records Not Created
- Check Inngest function execution logs
- Verify database connection
- Check for constraint violations in logs

---

## Next Steps

After completing these tests:
1. Document any issues found
2. Fix bugs
3. Re-test affected scenarios
4. Update STRIPE_TESTING_CHECKLIST.md with results


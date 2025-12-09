# Stripe Integration - Comprehensive Testing Checklist

**Status**: ⚠️ **Testing Needed** - Basic happy path documented, but comprehensive testing required

---

## ✅ Already Documented (in TESTING_CHECKOUT.md)

- [x] Basic checkout flow (happy path)
- [x] Webhook receipt verification
- [x] Database record creation verification
- [x] Test card usage

---

## 🔴 Critical Tests - Must Test Before Production

### 1. Webhook Security & Signature Verification

- [ ] **Test invalid webhook signature** - Should reject with 400 error
- [ ] **Test missing signature header** - Should reject with 400 error
- [ ] **Test webhook with wrong secret** - Should reject with 400 error
- [ ] **Test webhook replay attack** - Idempotency should prevent duplicate processing
- [ ] **Test webhook with malformed body** - Should handle gracefully

**Test Commands:**
```bash
# Test invalid signature
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "stripe-signature: invalid_signature" \
  -d '{"type":"checkout.session.completed"}'

# Test missing signature
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -d '{"type":"checkout.session.completed"}'
```

---

### 2. Idempotency Tests

- [ ] **Test duplicate webhook events** - Should not create duplicate records
  - Send same `checkout.session.completed` event twice
  - Verify: Only one order, payment, pack, and seat created
- [ ] **Test webhook retry after partial failure** - Should resume from last successful step
- [ ] **Test order already paid** - Should return early without processing
- [ ] **Test payment already exists** - Should return existing payment
- [ ] **Test pack already exists** - Should return existing pack
- [ ] **Test seat reservation already exists** - Should not create duplicate

**How to Test:**
1. Complete a checkout
2. Manually trigger webhook again (via Stripe CLI or dashboard)
3. Check database - should have no duplicates

---

### 3. Error Scenarios & Edge Cases

#### Checkout API Errors

- [ ] **Test with invalid packId** - Should return 404
- [ ] **Test with missing packId** - Should return 400 validation error
- [ ] **Test with pack that has no stripePriceId** - Should return 400
- [ ] **Test with unauthenticated user** - Should return 401
- [ ] **Test with invalid promotion code** - Should handle gracefully (Stripe will validate)
- [ ] **Test Stripe API failure** - Should mark order as failed
- [ ] **Test database failure during order creation** - Should handle gracefully
- [ ] **Test missing NEXT_PUBLIC_URL in production** - Should throw error

#### Webhook Processing Errors

- [ ] **Test webhook with missing order_id in metadata** - Should return 400
- [ ] **Test webhook with missing user_id in metadata** - Should return 400
- [ ] **Test webhook with missing pack_id in metadata** - Should return 400
- [ ] **Test webhook with invalid order_id** - Should handle gracefully
- [ ] **Test webhook with order that doesn't exist** - Should retry (Inngest handles this)
- [ ] **Test webhook with product that doesn't exist** - Should throw error
- [ ] **Test webhook with invalid payment_intent** - Should handle gracefully

#### Refund Processing Errors

- [ ] **Test refund for payment that doesn't exist** - Should throw error
- [ ] **Test refund for payment with no session pack** - Should handle gracefully
- [ ] **Test refund webhook with missing payment_intent** - Should return 400
- [ ] **Test partial refund** - Should update refunded_amount correctly
- [ ] **Test full refund** - Should release seat and mark pack as refunded

---

### 4. Discount & Pricing Tests

#### Grandfathered Pricing

- [ ] **Test checkout with grandfathered user** - Should auto-apply coupon
- [ ] **Test checkout with grandfathered user + customer promotion code** - Customer code should take precedence
- [ ] **Test checkout with non-grandfathered user** - Should not apply grandfathered discount
- [ ] **Test grandfathered discount calculation** - Verify discount amount in order record

#### Promotion Codes

- [ ] **Test checkout with valid promotion code** - Should apply discount
- [ ] **Test checkout with invalid promotion code** - Stripe should handle (test in Stripe Checkout UI)
- [ ] **Test checkout with expired promotion code** - Stripe should handle
- [ ] **Test checkout with promotion code that exceeds discount** - Stripe should handle
- [ ] **Test checkout with customer-entered code overriding grandfathered** - Customer code should win
- [ ] **Test discount tracking in order** - Verify `originalAmount`, `discountAmount`, `discountCode` fields

**Test Scenarios:**
1. Create promotion code in Stripe Dashboard
2. Test checkout with code
3. Verify discount appears in order record
4. Verify discount breakdown in Stripe session

---

### 5. Payment Flow Tests

#### Successful Payment Flow

- [ ] **Test complete checkout flow end-to-end**
  - Create checkout session
  - Complete payment with test card
  - Verify webhook received
  - Verify all database records created correctly
  - Verify redirect to success page
- [ ] **Test checkout session expiration** - Should expire after 24 hours
- [ ] **Test payment with 3D Secure** - Use card `4000 0025 0000 3155`
- [ ] **Test payment with declined card** - Use card `4000 0000 0000 0002`

#### Failed Payment Flow

- [ ] **Test checkout cancellation** - Should redirect to cancel page
- [ ] **Test payment decline** - Should not create records
- [ ] **Test order cleanup on failure** - Verify order marked as "failed"

---

### 6. Refund Flow Tests

- [ ] **Test full refund** - Should release seat, mark pack as refunded
- [ ] **Test partial refund** - Should update refunded_amount (if implemented)
- [ ] **Test refund for pack with sessions used** - Should handle correctly
- [ ] **Test refund for pack with no sessions used** - Should be full refund
- [ ] **Test refund webhook processing** - Verify all status updates
- [ ] **Test refund idempotency** - Duplicate refund webhooks should not cause issues

**How to Test:**
1. Complete a checkout
2. In Stripe Dashboard → Payments → Select payment → Refund
3. Verify webhook received
4. Check database: pack status = "refunded", seat status = "released"

---

### 7. Database & Data Integrity Tests

- [ ] **Test order creation with correct status** - Should be "pending" initially
- [ ] **Test order update to "paid"** - After webhook processing
- [ ] **Test payment record creation** - Verify all fields populated correctly
- [ ] **Test session pack creation** - Verify `remaining_sessions = total_sessions`
- [ ] **Test seat reservation creation** - Verify `status = "active"`
- [ ] **Test pack expiration date** - Should be `purchased_at + validity_days`
- [ ] **Test seat expiration date** - Should match pack expiration
- [ ] **Test currency handling** - Verify currency stored correctly (USD)
- [ ] **Test amount calculations** - Verify amounts in dollars (not cents)

---

### 8. Inngest Function Tests

- [ ] **Test Inngest retry on failure** - Should retry up to 3 times
- [ ] **Test Inngest step-by-step execution** - Verify each step completes
- [ ] **Test Inngest idempotency** - Same event should not process twice
- [ ] **Test Inngest error handling** - Should log errors appropriately
- [ ] **Test Inngest event schema validation** - Invalid events should be rejected

**How to Test:**
1. Check Inngest Dashboard for function executions
2. Trigger test events manually
3. Verify step-by-step execution logs

---

### 9. Integration Tests

- [ ] **Test checkout → webhook → pack creation flow** - End-to-end
- [ ] **Test checkout → payment → refund flow** - End-to-end
- [ ] **Test concurrent checkout requests** - Should handle race conditions
- [ ] **Test checkout with seat availability check** - Should prevent if no seats
- [ ] **Test checkout with expired pack** - Should not allow (if implemented)

---

### 10. Security Tests

- [ ] **Test authentication required** - Unauthenticated users should get 401
- [ ] **Test authorization** - Users should only see their own orders
- [ ] **Test metadata validation** - Invalid metadata should be rejected
- [ ] **Test SQL injection attempts** - Should be prevented (via Drizzle ORM)
- [ ] **Test XSS in metadata** - Should be sanitized
- [ ] **Test rate limiting** - Should prevent abuse (if implemented)

---

### 11. Production Readiness Tests

- [ ] **Test with production Stripe keys** - Verify live mode works
- [ ] **Test webhook endpoint in production** - Verify accessible from Stripe
- [ ] **Test SSL/TLS** - Webhook endpoint should use HTTPS
- [ ] **Test environment variable validation** - Missing vars should error clearly
- [ ] **Test error logging** - Errors should be logged (Axiom/console)
- [ ] **Test monitoring** - Set up alerts for webhook failures

---

## 🧪 Test Data Setup

### Required Test Data

1. **Test Product in Database:**
   - ID: `24cfcc67-ff04-4d57-a702-b0e8c55bbb23` (or create new)
   - Must have `stripePriceId` configured
   - Must be linked to a mentor

2. **Test Stripe Data:**
   - Test Price ID: `price_1SbNPUA4l1a5LDm782TSgPx6` (or create new)
   - Test Promotion Code (optional)
   - Test Coupon for grandfathered users (optional)

3. **Test User:**
   - Clerk test user
   - Optionally: Grandfathered user for discount testing

---

## 📝 Test Execution Plan

### Phase 1: Security & Idempotency (Critical)
1. Webhook signature verification tests
2. Idempotency tests
3. Error handling tests

### Phase 2: Core Functionality
1. Happy path checkout flow
2. Discount scenarios
3. Refund flow

### Phase 3: Edge Cases
1. Error scenarios
2. Invalid data handling
3. Concurrent requests

### Phase 4: Production Readiness
1. Production environment tests
2. Monitoring setup
3. Documentation review

---

## 🐛 Known Issues / Areas of Concern

- [ ] **No automated test suite** - All testing is manual
- [ ] **No unit tests** - Functions not tested in isolation
- [ ] **No integration test framework** - End-to-end tests are manual
- [ ] **Partial refund logic** - May need additional testing if implemented
- [ ] **Seat availability check** - Not verified in checkout flow
- [ ] **Error logging** - Need to verify errors are logged to Axiom

---

## 📚 Test Resources

- **Stripe Test Cards**: https://stripe.com/docs/testing
- **Stripe CLI**: https://stripe.com/docs/stripe-cli
- **Inngest Dashboard**: Check function executions and logs
- **Supabase Dashboard**: Verify database records
- **Vercel Logs**: Check API route logs

---

## ✅ Sign-Off Checklist

Before marking Stripe integration as production-ready:

- [ ] All Critical Tests (Section 1-2) passed
- [ ] All Error Scenarios (Section 3) tested
- [ ] Discount scenarios (Section 4) verified
- [ ] Refund flow (Section 6) tested
- [ ] Security tests (Section 10) passed
- [ ] Production environment tested (Section 11)
- [ ] Monitoring and alerting configured
- [ ] Documentation updated
- [ ] Team review completed

---

**Last Updated**: Current Session  
**Next Review**: After PayPal integration


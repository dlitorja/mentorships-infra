# Stripe Integration Testing - Quick Start Guide

This guide helps you quickly test the high and medium priority items for Stripe integration.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Install tsx for running TypeScript scripts
pnpm add -D tsx
```

### 2. Start Development Server

```bash
# Terminal 1: Start the dev server
cd apps/web
pnpm dev
```

### 3. Start Stripe CLI (for webhook testing)

```bash
# Terminal 2: Start Stripe CLI webhook forwarding
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

**Important:** Copy the webhook secret (starts with `whsec_...`) from the CLI output and add it to `apps/web/.env.local`:
```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 4. Run Automated Tests

```bash
# Terminal 3: Run automated tests
pnpm test:stripe
```

Or run specific test categories:
```bash
pnpm tsx scripts/test-stripe-integration.ts webhook-signature
pnpm tsx scripts/test-stripe-integration.ts checkout-errors
pnpm tsx scripts/test-stripe-integration.ts metadata
pnpm tsx scripts/test-stripe-integration.ts refund
```

---

## 📋 Test Checklist

### High Priority Tests

#### ✅ Automated (via test script)
- [x] Webhook signature verification
- [x] Missing signature header
- [x] Invalid signature
- [x] Checkout API validation errors
- [x] Webhook metadata validation
- [x] Refund webhook validation

#### 🔧 Manual Tests (see `scripts/test-stripe-manual.md`)

**Idempotency:**
- [ ] Duplicate webhook events
- [ ] Order already paid check
- [ ] Payment already exists check

**Error Scenarios:**
- [ ] Invalid packId
- [ ] Pack without stripePriceId
- [ ] Missing metadata in webhook
- [ ] Stripe API failure

**Refund Flow:**
- [ ] Full refund processing
- [ ] Refund for non-existent payment

### Medium Priority Tests

**Discount & Pricing:**
- [ ] Grandfathered pricing
- [ ] Customer promotion code
- [ ] Customer code overrides grandfathered

**Edge Cases:**
- [ ] Concurrent checkout requests
- [ ] Webhook retry after failure
- [ ] 3D Secure payment

---

## 🧪 Running Tests

### Automated Tests

The automated test script (`scripts/test-stripe-integration.ts`) tests:
- Webhook signature verification
- API error handling
- Metadata validation

**Run all automated tests:**
```bash
pnpm test:stripe
```

**Run specific test:**
```bash
pnpm tsx scripts/test-stripe-integration.ts [test-name]
```

Available test names:
- `webhook-signature` - Test webhook signature verification
- `checkout-errors` - Test checkout API error scenarios
- `metadata` - Test webhook metadata validation
- `refund` - Test refund webhook validation

### Manual Tests

For manual tests that require authentication, database interactions, or real Stripe events, see:
- **`scripts/test-stripe-manual.md`** - Detailed manual testing procedures

---

## 📊 Expected Results

### Automated Tests

All automated tests should pass:
```
✅ Missing signature header rejected
✅ Invalid signature rejected
✅ Missing packId validation
✅ Invalid packId format validation
✅ Unauthenticated request rejected
✅ Missing metadata rejected
✅ Missing payment_intent in refund rejected
```

### Manual Tests

Follow the procedures in `scripts/test-stripe-manual.md` and verify:
- No duplicate records created
- Errors handled gracefully
- Refunds process correctly
- Discounts apply correctly

---

## 🐛 Troubleshooting

### Test Script Fails

**Error: "STRIPE_SECRET_KEY not set"**
- Make sure `.env.local` in `apps/web/` has `STRIPE_SECRET_KEY`
- Restart dev server after adding env vars

**Error: "STRIPE_WEBHOOK_SECRET not set"**
- Get webhook secret from Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Add to `.env.local` as `STRIPE_WEBHOOK_SECRET`

**Error: "Cannot find module 'tsx'"**
- Install tsx: `pnpm add -D tsx`

**Error: "Connection refused"**
- Make sure dev server is running: `cd apps/web && pnpm dev`

### Manual Tests Fail

**Webhook not received:**
- Check Stripe CLI is running
- Verify webhook secret matches
- Check server logs for errors

**Database records not created:**
- Check Inngest Dashboard for function execution
- Verify database connection
- Check Inngest function logs

---

## 📝 Test Results Template

Use this to track your test results:

```markdown
## Test Results - [Date]

### Automated Tests
- [x] Webhook signature verification
- [x] Checkout API errors
- [x] Metadata validation
- [x] Refund validation

### Manual Tests - High Priority
- [ ] Duplicate webhook events
- [ ] Order already paid
- [ ] Invalid packId
- [ ] Full refund flow

### Manual Tests - Medium Priority
- [ ] Grandfathered pricing
- [ ] Promotion codes
- [ ] Concurrent requests

### Issues Found
- [List any issues found]

### Next Steps
- [What needs to be fixed or retested]
```

---

## 🔗 Related Documents

- **`STRIPE_TESTING_CHECKLIST.md`** - Complete testing checklist
- **`scripts/test-stripe-manual.md`** - Detailed manual testing guide
- **`TESTING_CHECKOUT.md`** - Basic checkout flow testing
- **`TECH_DECISIONS_FINAL.md`** - Implementation details

---

## ✅ Next Steps After Testing

1. **Document Results** - Update test results in checklist
2. **Fix Issues** - Address any bugs found
3. **Re-test** - Verify fixes work
4. **Production Readiness** - Complete production readiness tests
5. **Update Documentation** - Update PROJECT_STATUS.md with test results


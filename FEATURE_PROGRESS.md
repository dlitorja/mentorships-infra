# Feature Progress Report

## 1. Checkout with Stripe or PayPal

| App | Status | Details |
|-----|--------|---------|
| **apps/web** | ✅ Implemented | Stripe & PayPal checkout APIs, webhooks |
| **apps/marketing** | ⚠️ Partial | Only Kajabi external checkout links |

**Implementation:**
- `apps/web/app/api/checkout/stripe/route.ts` - Stripe Checkout Session creation
- `apps/web/app/api/checkout/paypal/route.ts` - PayPal order creation
- `apps/web/app/api/webhooks/stripe/route.ts` - Payment processing
- `apps/web/app/api/webhooks/paypal/route.ts` - Payment processing
- `apps/marketing/lib/instructors.ts` - Kajabi offer URLs (external)

---

## 2. Grandfathered Pricing (Admin creates multiple pricing offers)

| App | Status | Details |
|-----|--------|---------|
| **apps/web** | ⚠️ Partial | Code exists for grandfathered pricing via env vars, but no admin UI to create multiple offers |
| **apps/marketing** | ❌ Not implemented | No pricing management |

**Implementation:**
- `packages/db/src/lib/queries/discounts.ts` - `getGrandfatheredConfig()`, `isUserGrandfathered()`, `getGrandfatheredDiscount()`
- Environment variables required: `GRANDFATHERED_COUPON_ID`, `GRANDFATHERED_PROMOTION_CODE`, `GRANDFATHERED_BEFORE_DATE`
- Only applied to Stripe checkout (not PayPal)

**Gap:** No admin UI to create/manage multiple pricing offers. Only single grandfathered pricing via env vars.

---

## 3. Refunds (Admin issues from dashboard)

| App | Status | Details |
|-----|--------|---------|
| **apps/web** | ⚠️ Partial | Webhook-based processing only, no admin UI |
| **apps/marketing** | ❌ Not implemented | No refund functionality |

**Implementation:**
- `apps/web/inngest/functions/payments.ts` - Handles `stripe/charge.refunded` and `paypal/payment.capture.refunded` events

**Gaps:**
- ❌ No admin UI to trigger refunds
- ❌ No partial refunds support
- ❌ No selectable refund reason
- ❌ No refund notification email

Refunds can only be initiated from Stripe/PayPal dashboards, not from the application.

---

## 4. Post-Purchase Emails

| App | Status | Details |
|-----|--------|---------|
| **apps/web** | ⚠️ Partial | Sends to purchaser only |
| **apps/marketing** | ❌ Not implemented | No email sending |

**Implementation:**
- `apps/web/lib/emails/purchase-onboarding-email.ts` - Email template
- `apps/web/inngest/functions/onboarding.ts` - Triggered on `purchase/mentorship` event

**Gaps:**
- ❌ No email sent to instructor when purchase is made

---

## 5. Instructor Dashboard (Mentees, Sessions, Last Session Date)

| App | Status | Details |
|-----|--------|---------|
| **apps/web** | ✅ Implemented | Dashboard with session list |
| **apps/marketing** | ✅ Implemented | Full dashboard with mentee list, session counts, last session date |

**Implementation:**

**apps/marketing:**
- `apps/marketing/app/instructor/dashboard/page.tsx` - Active mentees, session counts, last session date
- `apps/marketing/components/admin/instructors-table.tsx` - Mentee management, session increment/decrement

**apps/web:**
- `apps/web/app/instructor/dashboard/page.tsx` - Active students, upcoming sessions
- `apps/web/app/instructor/sessions/page.tsx` - Session list with remaining sessions

**Database queries** (`@mentorships/db`):
- `getMentorMenteesWithSessionInfo` - Full mentee list with session counts
- `getMentorMenteesWithLowSessions` - Low session alerts
- `getMentorUpcomingSessions` / `getMentorPastSessions` - Session tracking

---

## 6. Payment Implementation Plan (Stripe & PayPal)

**Last Updated:** April 2026

### Current Assessment

| Component | Status | Location |
|-----------|--------|----------|
| Stripe client & checkout | ✅ Implemented | `apps/web/lib/stripe.ts`, `apps/web/app/api/checkout/stripe/route.ts` |
| Stripe webhooks | ✅ Implemented | `apps/web/app/api/webhooks/stripe/route.ts` |
| PayPal webhooks | ✅ Implemented | `apps/web/app/api/webhooks/paypal/route.ts` |
| Payment processing (Inngest) | ✅ Implemented | `apps/web/inngest/functions/payments.ts` |
| Refund processing | ✅ Implemented | Both Stripe & PayPal via webhooks |
| Refund helper (partial support) | ✅ Implemented | `packages/payments/src/stripe/refunds.ts` (`calculateRefundAmount`) |
| Checkout UI | ⚠️ Basic | `apps/web/app/checkout/page.tsx` - requires manual product ID entry |
| Admin UI - Payments | ❌ Not implemented | No admin dashboard for payments |
| Admin UI - Offers | ❌ Not implemented | No admin dashboard for creating offers |
| PayPal checkout UI | ❌ Not implemented | Only Stripe available |

---

### Implementation Phases

#### Phase 1: Checkout UI Enhancement ✅ Completed (April 2026)

**Goal:** Create user-friendly checkout with product selection and both payment options

| Task | Description | Status |
|------|-------------|--------|
| 1.1 | Add product selection to checkout page (remove manual ID entry) | ✅ |
| 1.2 | Create PayPal checkout API route (`/api/checkout/paypal`) | ✅ |
| 1.3 | Add PayPal payment button to checkout UI | ✅ |
| 1.4 | Unified checkout page supporting both Stripe & PayPal | ✅ |

**Files modified:**
- `apps/web/app/checkout/page.tsx` - Replaced manual ID input with product card selector
- `apps/web/lib/queries/api-client.ts` - Added `fetchProducts()` and `createPayPalCheckoutSession()`
- `apps/web/lib/queries/query-keys.ts` - Added products list query key
- `apps/web/app/api/products/route.ts` - New public endpoint for listing active products

---

#### Phase 2: Admin Dashboard - Payments & Refunds ⬜ Not Started

**Goal:** Enable payment management and refunds from admin UI

| Task | Description | Status |
|------|-------------|--------|
| 2.1 | Create admin page to view all payments | ⬜ |
| 2.2 | Add ability to issue full refunds from admin | ⬜ |
| 2.3 | Add ability to issue partial refunds from admin | ⬜ |
| 2.4 | Show payment history per order/user | ⬜ |

**Files to create:**
- `apps/web/app/admin/payments/page.tsx` - Payment list view
- `apps/web/app/api/admin/refunds/route.ts` - API for processing refunds

---

#### Phase 3: Admin Dashboard - Offers ⬜ Not Started

**Goal:** Create offers without using Stripe/PayPal dashboards

| Task | Description | Status |
|------|-------------|--------|
| 3.1 | Create admin UI to manage Stripe coupons/promotion codes | ⬜ |
| 3.2 | Create admin UI to manage PayPal discounts | ⬜ |
| 3.3 | Link offers to products | ⬜ |

---

### Notes
- apps/marketing has no payment code - uses Kajabi external checkout
- For merging apps/web + apps/marketing: payment code exists in apps/web
- Products have `stripePriceId` and `paypalProductId` fields in schema
- Grandfathered pricing exists via env vars but no admin UI

---

### Environment Setup

#### Stripe
1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Secret Key** (starts with `sk_test_`) → `STRIPE_SECRET_KEY`
3. Go to **Developers** → **Webhooks** → **Add endpoint**
4. Add your deployment URL: `https://your-app.vercel.app/api/webhooks/stripe`
5. Copy **Webhook Signing Secret** → `STRIPE_WEBHOOK_SECRET`

#### PayPal
1. Go to https://developer.paypal.com/
2. Log in with your PayPal business account
3. Go to **Dashboard** → **My Apps** → **Create App**
4. Create app in **Sandbox** mode for testing
5. Copy **Client ID** → `PAYPAL_CLIENT_ID`
6. Copy **Secret** → `PAYPAL_CLIENT_SECRET`
7. Set `PAYPAL_MODE=sandbox` (use `live` for production later)

#### Required Environment Variables
```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx  # For Elements if used

# PayPal
PAYPAL_CLIENT_ID=xxx
PAYPAL_CLIENT_SECRET=xxx
PAYPAL_MODE=sandbox

# General
NEXT_PUBLIC_URL=https://your-app.vercel.app
DATABASE_URL=postgres://...
```

---

## Summary

| Feature | Fully Implemented | Partial | Not Implemented |
|---------|-------------------|---------|-----------------|
| Stripe/PayPal Checkout | apps/web | apps/marketing (Kajabi) | - |
| Grandfathered Pricing | - | apps/web (env vars only) | apps/marketing, Admin UI |
| Refunds | - | apps/web (webhook only) | Admin UI, partial, reasons |
| Purchase Emails | apps/web (purchaser) | - | Instructor notification |
| Instructor Dashboard | apps/web, apps/marketing | - | - |

---

## Key Gaps to Address

1. **Admin UI for pricing offers** - Create interface to manage multiple grandfathered pricing options
2. **Admin refund UI** - Full/partial refunds with selectable reason, triggered from admin dashboard
3. **Instructor email notification** - Send email to instructor when purchase completed
4. **PayPal grandfathered pricing** - Apply grandfathered discounts to PayPal checkout

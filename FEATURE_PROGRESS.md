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

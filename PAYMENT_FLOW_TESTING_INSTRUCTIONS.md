# Payment Flow Testing Instructions

Complete guide for testing the end-to-end mentorship purchase flow, including instructor setup, customer checkout, onboarding emails, and dashboard verification.

---

## Part 1: Admin Setup

### 1.1 Create Instructor

1. Go to `http://localhost:3000/admin/instructors/create`
2. Fill in details:
   - **Name**: Test Instructor
   - **Email**: test-instructor@example.com
   - **Max Active Students**: 10
   - **One-on-One Inventory**: 5
3. Submit form

### 1.2 Create Product

1. Go to `http://localhost:3000/admin/products`
2. Click **Create Product** tab
3. Fill in details:
   - **Title**: "4-Session Mentorship Pack"
   - **Instructor**: Select Test Instructor
   - **Sessions Per Pack**: 4
   - **Price**: 199.00
   - **Validity Days**: 60
   - **Mentorship Type**: One-on-One
   - **Enable Stripe**: Yes
   - **Enable PayPal**: Yes
4. Submit form

### 1.3 Verify Inventory

Go to `http://localhost:3000/admin/inventory` - confirm instructor shows 5 spots available.

---

## Part 2: Customer Checkout (Stripe)

### 2.1 Browse & Select

1. Go to `http://localhost:3000/instructors`
2. Click on Test Instructor's profile
3. Verify product displays with "Buy Now" button
4. Click "Buy Now" → redirects to `/checkout?instructor=[slug]&type=one-on-one`

### 2.2 Complete Stripe Payment

1. On checkout page, select **Stripe** payment method
2. Click "Purchase"
3. On Stripe Checkout:
   - Card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/28)
   - CVC: Any 3 digits (e.g., 123)
   - ZIP: Any 5 digits (e.g., 12345)
4. Complete payment

**Expected**: Redirect to `/checkout/success`, order status changes to "paid"

### 2.3 PayPal Checkout (Alternative)

1. Same as 2.1, but select **PayPal** payment method
2. Complete PayPal flow in popup window

---

## Part 3: Verify Post-Purchase

### 3.1 Database Records

Check these were created:

| Record | Status |
|--------|--------|
| **Order** | `paid` (was `pending`) |
| **Payment** | `completed`, amount = $199 |
| **Session Pack** | `active`, remainingSessions = 4 |
| **Seat Reservation** | `active` |
| **Workspace** | links customer to instructor |

### 3.2 Onboarding Emails (Check Inboxes)

You should receive **3 emails**:

| Recipient | Subject Contains | Content |
|-----------|------------------|---------|
| **Customer** | "Welcome — your mentorship" | Dashboard link, onboarding form, Discord CTA |
| **Instructor** | "[Student Name] has purchased" | Student details, session count |
| **Admin** | "New mentorship purchase" | Order details, amount, provider |

### 3.3 Dashboard Verification

**Student Dashboard** (`/dashboard`):
- Session pack card shows 4/4 sessions remaining
- Instructor card displayed with "4 sessions remaining"

**Instructor Dashboard** (`/instructor/dashboard`):
- Mentees list shows test customer
- Session pack shown with 4 sessions

**Admin Dashboard** (`/admin`):
- Recent orders shows new order with "Paid" status
- Revenue updated

---

## Part 4: Low Session Warning (1 Session Remaining)

### 4.1 Simulate Session Usage

Manually decrement customer's session pack to 1 remaining session (via admin API or Convex dashboard).

### 4.2 Expected Warnings

**Student Dashboard**:
- Amber alert: "Session Renewal Reminder"
- Message: "You have 1 session remaining. Renew now to keep momentum."

**Email Sent** (to student):
- Subject: "1 session left — renew now to keep momentum"
- CTA button → `/instructors`

**Instructor Dashboard**:
- Alert: "Mentee Renewal Opportunities"
- Lists customer with 1 session remaining

---

## Part 5: Grace Period (0 Sessions)

When all 4 sessions are used:

1. **Seat Status**: Changes to `grace`
2. **Grace Period**: 7 days (was 72 hours)
3. **Final Warning Email**: Sent 12 hours before grace period ends
4. **Workspace Access**: Maintained during grace period

---

## Part 6: Refund Testing

### 6.1 Full Refund

1. Go to `http://localhost:3000/admin/orders`
2. Find test order → Click "Refund"
3. Select "Full Refund"
4. Reason: "Requested by customer"
5. Submit

**Expected**:
- Payment refunded
- Order status → `refunded`
- Session pack status → `refunded`
- Instructor inventory restored
- Student receives refund email

### 6.2 Partial Refund

1. Same as 6.1, but select "Partial Refund"
2. Enter amount less than total
3. Submit

---

## Test Account Quick Reference

### Stripe Test Cards

| Scenario | Card Number |
|----------|-------------|
| Success | `4242 4242 4242 4242` |
| Decline | `4000 0000 0000 0002` |
| 3D Secure | `4000 0025 0000 3155` |

### Required Environment Variables

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PayPal
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_MODE=sandbox

# Email
RESEND_API_KEY=re_...
EMAIL_FROM=Huckleberry Mentorships <onboarding@huckleberry.art>

# Other
ADMIN_EMAILS=admin@huckleberry.art
NEXT_PUBLIC_URL=http://localhost:3000
```

### Test URLs (Local)

| Purpose | URL |
|---------|-----|
| Admin - Create Instructor | `/admin/instructors/create` |
| Admin - Create Product | `/admin/products` |
| Admin - Orders/Refunds | `/admin/orders` |
| Admin - Inventory | `/admin/inventory` |
| Browse Instructors | `/instructors` |
| Checkout | `/checkout?instructor=[slug]&type=one-on-one` |
| Student Dashboard | `/dashboard` |
| Instructor Dashboard | `/instructor/dashboard` |

---

## Verification Checklist

- [ ] Instructor created with 5 spots inventory
- [ ] Product created with Stripe + PayPal enabled
- [ ] Customer can view instructor profile
- [ ] Customer can complete Stripe checkout
- [ ] Customer can complete PayPal checkout
- [ ] Order status changes to "paid"
- [ ] Payment record created ($199)
- [ ] Session pack created (4/4 sessions)
- [ ] Seat reservation created
- [ ] Workspace created linking customer + instructor
- [ ] Student receives onboarding email
- [ ] Instructor receives new student email
- [ ] Admin receives purchase notification email
- [ ] Student dashboard shows session pack
- [ ] Instructor dashboard shows new mentee
- [ ] Admin sees order in orders list
- [ ] Low session warning appears at 1 session
- [ ] Grace period works (7 days)
- [ ] Full refund works
- [ ] Partial refund works
- [ ] Inventory restored after refund
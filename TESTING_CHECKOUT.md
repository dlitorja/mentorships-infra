# End-to-End Checkout Flow Testing Guide

## Overview

This guide tests the complete mentorship purchase flow:
1. Admin creates instructor + product
2. Customer browses instructors and purchases
3. Stripe/PayPal checkout completes
4. Onboarding emails sent (student, instructor, admin)
5. Workspace created linking customer and instructor
6. Dashboard shows remaining sessions
7. Low session warnings trigger when 1 session remains

---

## Prerequisites

### Environment Variables Required

In `apps/web/.env.local`:

```env
# Stripe (sandbox)
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PayPal (sandbox)
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_MODE=sandbox

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=Huckleberry Mentorships <onboarding@huckleberry.art>

# App
NEXT_PUBLIC_URL=http://localhost:3000
ADMIN_EMAILS=admin@huckleberry.art,your@email.com

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

---

## Phase 1: Admin Setup - Create Instructor and Product

### Step 1.1: Create Instructor

1. Go to `http://localhost:3000/admin/instructors/create`
2. Fill in instructor details:
   - Name: Test Instructor
   - Email: test-instructor@example.com
   - Bio: Test bio for mentorship sessions
   - Max Active Students: 10
   - One-on-One Inventory: 5
3. Submit form

### Step 1.2: Create Product for Instructor

1. Go to `http://localhost:3000/admin/products`
2. Click "Create Product" tab
3. Fill in product details:
   - Title: "4-Session Mentorship Pack"
   - Instructor: Select Test Instructor
   - Sessions Per Pack: 4
   - Price: 199.00
   - Validity Days: 60
   - Mentorship Type: One-on-One
   - Enable Stripe: Yes
   - Enable PayPal: Yes
4. Submit form

**Expected Result:**
- Product created in database
- Product synced to Stripe (Price ID generated)
- Product synced to PayPal (Product ID generated)

### Step 1.3: Verify Inventory

1. Go to `http://localhost:3000/admin/inventory`
2. Confirm instructor's "One-on-One Inventory" shows 5 spots available

---

## Phase 2: Customer Purchase Flow

### Step 2.1: Browse Instructors

1. Go to `http://localhost:3000/instructors`
2. Click on Test Instructor's profile page
3. Verify product is displayed with "Buy Now" button

### Step 2.2: Initiate Checkout (Stripe)

1. On instructor profile, click "Buy Now" for the product
2. You'll be redirected to `/checkout?instructor=[slug]&type=one-on-one`
3. Verify:
   - Product details shown (title, price, sessions)
   - Stripe and PayPal payment options available
4. Select **Stripe** payment method
5. Click "Purchase"

**Expected Result:**
- Redirect to Stripe Checkout
- Order created in database with status `pending`

### Step 2.3: Complete Stripe Payment

1. On Stripe Checkout page:
   - Email: use a real email to receive receipts
   - Card: use test card `4242 4242 4242 4242`
   - Expiry: any future date (e.g., 12/28)
   - CVC: any 3 digits (e.g., 123)
   - ZIP: any 5 digits (e.g., 12345)
2. Click "Pay $199.00"

**Expected Result:**
- Payment completes successfully
- Redirect to `/checkout/success`

### Step 2.4: Alternative - PayPal Checkout

1. Start same checkout process
2. Select **PayPal** payment method
3. Click "Purchase"
4. Complete PayPal checkout flow in popup window

---

## Phase 3: Verify Post-Purchase Flow

### Step 3.1: Database Verification

Check the following records were created:

**Order:**
- Status changed from `pending` to `paid`
- Provider: `stripe` or `paypal`

**Payment:**
- Status: `completed`
- Amount matches product price

**Session Pack:**
- Status: `active`
- `remainingSessions` equals `totalSessions` (4)
- `expiresAt` set to ~60 days from now

**Seat Reservation:**
- Status: `active`
- Links customer to instructor

**Workspace:**
- Created linking customer user ID to instructor
- Name: "Mentorship Workspace"

### Step 3.2: Onboarding Emails

Check email inboxes for:

1. **Student email** (to customer email):
   - Subject: "Welcome — your mentorship with [Instructor Name] is ready"
   - Contains: Dashboard link, onboarding form link, Discord CTA

2. **Instructor email** (to instructor email):
   - Subject: "[Student Name] has purchased mentorship with you"
   - Contains: Student details, session count, dashboard link

3. **Admin email** (to ADMIN_EMAILS):
   - Subject: "New mentorship purchase - [Student Name] with [Instructor Name]"
   - Contains: Order details, student/instructor info, amount, provider

### Step 3.3: Webhook Verification (Local Testing)

If testing locally, verify webhooks in Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Look for:
```
--> checkout.session.completed [evt_xxx]
<-- [200] POST /api/webhooks/stripe
```

---

## Phase 4: Dashboard Verification

### Step 4.1: Student/Mentee Dashboard

1. Go to `http://localhost:3000/dashboard`
2. Sign in as the test customer account
3. Verify:
   - **Session Pack Card**: Shows remaining sessions (4/4)
   - **Instructor Card**: Shows Test Instructor with "4 sessions remaining"
   - **Low Session Alert**: Should NOT appear yet (only shows when 1 session left)

### Step 4.2: Instructor Dashboard

1. Go to `http://localhost:3000/instructor/dashboard`
2. Sign in as the test instructor account
3. Verify:
   - **Mentees List**: Shows test customer
   - **Session Packs**: Shows customer's pack with 4 sessions
   - **Low Session Alerts**: Should NOT appear yet

### Step 4.3: Admin Dashboard

1. Go to `http://localhost:3000/admin`
2. Verify:
   - **Recent Orders**: Shows the new order with "Paid" status
   - **Revenue**: Updated with purchase amount

---

## Phase 5: Session Usage and Warning Testing

### Step 5.1: Simulate Session Completion

To test warning notifications, simulate using sessions:

1. Go to Convex dashboard or use admin API to manually decrement sessions
2. Or use the instructor's session management to mark sessions as complete

### Step 5.2: Verify Low Session Warning (1 Session Remaining)

When `remainingSessions` reaches 1:

1. **Student Dashboard**:
   - Amber alert appears: "Session Renewal Reminder"
   - Message: "You have 1 session remaining. Renew now to keep momentum."

2. **Email Sent** (to student email):
   - Subject: "1 session left — renew now to keep momentum"
   - CTA button links to `/instructors`

3. **Instructor Dashboard**:
   - Alert shows: "Mentee Renewal Opportunities"
   - Lists customer with 1 session remaining

### Step 5.3: Verify Grace Period (0 Sessions)

When all sessions are used:

1. **Grace Period Begins**:
   - Seat reservation status: `grace`
   - Grace period ends: 7 days from now

2. **Final Warning Email**:
   - Subject: "Your pack is complete — renew within 72 hours to keep your seat"
   - Note: This email will be updated to say "7 days" in future PR

3. **12-Hour Warning**:
   - If customer doesn't renew, 12 hours before grace period ends
   - Final warning email sent

---

## Phase 6: Refund Testing

### Step 6.1: Process Full Refund

1. Go to `http://localhost:3000/admin/orders`
2. Find the test order
3. Click "Refund" button
4. Select "Full Refund"
5. Select reason: "Requested by customer"
6. Submit

**Expected Result:**
- Payment provider processes refund
- Order status: `refunded`
- Session pack status: `refunded`
- Inventory restored (instructor's spot available again)
- Student receives refund email

### Step 6.2: Process Partial Refund

1. Go to order with remaining sessions
2. Click "Refund"
3. Select "Partial Refund"
4. Enter refund amount (less than total)
5. Select reason
6. Submit

**Expected Result:**
- Only partial amount refunded
- Session pack sessions reduced proportionally
- Refund record shows partial amount

---

## Test Accounts

### Stripe Test Cards

| Scenario | Card Number |
|----------|-------------|
| Success | `4242 4242 4242 4242` |
| Decline | `4000 0000 0000 0002` |
| 3D Secure | `4000 0025 0000 3155` |

### PayPal Sandbox

Use PayPal sandbox account:
- Create account at https://sandbox.paypal.com
- Add test funding sources

---

## Troubleshooting

### "Order not found" after payment
- Check webhook endpoint is accessible
- Verify `STRIPE_WEBHOOK_SECRET` matches Stripe CLI output

### No emails received
- Check Resend API key is valid
- Check spam/junk folders
- Verify `EMAIL_FROM` is a verified domain in Resend

### Workspace not created
- Check Inngest functions are running
- Check `createSeatReservation` mutation completes
- Verify `seatReservations` table has new record

### Inventory not decremented
- Check `decrementInventory` mutation was called
- Verify instructor's inventory counts in admin

---

## Environment URLs

| Environment | URL |
|-------------|-----|
| Local Development | http://localhost:3000 |
| Admin Dashboard | http://localhost:3000/admin |
| Instructor Dashboard | http://localhost:3000/instructor/dashboard |
| Student Dashboard | http://localhost:3000/dashboard |
| Browse Instructors | http://localhost:3000/instructors |
| Checkout | http://localhost:3000/checkout |

---

## Verification Checklist

- [ ] Instructor created with inventory
- [ ] Product created with Stripe/PayPal integration
- [ ] Customer can view instructor profile
- [ ] Customer can complete Stripe checkout
- [ ] Customer can complete PayPal checkout
- [ ] Order status changes to "paid"
- [ ] Payment record created
- [ ] Session pack created with correct sessions
- [ ] Seat reservation created
- [ ] Workspace created linking customer and instructor
- [ ] Student receives onboarding email
- [ ] Instructor receives purchase notification email
- [ ] Admin receives purchase notification email
- [ ] Student dashboard shows session pack
- [ ] Instructor dashboard shows new mentee
- [ ] Admin sees order in orders list
- [ ] Full refund works correctly
- [ ] Partial refund works correctly
- [ ] Inventory restored after refund
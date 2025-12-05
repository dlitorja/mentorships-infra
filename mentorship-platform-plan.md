# Mentorship Platform --- Payments, Sessions & Seat Retention Architecture

## 1. Executive Summary

This platform replaces Kajabi with a custom-built system using:

-   **Next.js** for Web App
-   **Supabase** for Database & Auth
-   **Stripe + PayPal** for One‑Time Payments
-   **Agora or AWS Chime** for Video Calls
-   **Google Calendar API** for Scheduling
-   **Discord Bot** for Automation & Messaging

**Key Business Model Change:**\
No recurring subscriptions. All mentorships are sold as **packs of 4
sessions** with automated renewal reminders and automatic seat release.

This eliminates: - Subscription billing complexity - Failed
auto‑renewals - Manual rescheduling/payment reconciliation - Proration &
chargeback headaches

------------------------------------------------------------------------

## 2. Core Business Model

### Session Pack Model

-   Each purchase = **4 sessions**
-   Fixed validity window (e.g. 30--45 days)
-   No auto-renew
-   Manual repurchase required to continue

### Seat Retention System

-   Each active student reserves **one mentor seat**
-   Seats are released automatically if:
    -   Pack expires
    -   All sessions used and renewal grace period ends

### Automated Renewal Reminders

  Trigger                   Action
  ------------------------- ---------------------------------
  Session 3 completed       Renewal Reminder
  Session 4 completed       Booking locked + Renewal Notice
  12h before seat release   Final Warning
  Grace expires             Seat released to waitlist

------------------------------------------------------------------------

## 3. Supported Payment Methods

### Stripe (Primary)

-   Stripe Checkout (one‑time only)
-   Refund API
-   Webhooks
-   No Billing, No Subscriptions

### PayPal (Secondary)

-   PayPal Orders API
-   One‑time payments only
-   Webhooks for completed + refunded events

Both normalize into the same internal `orders` and `payments` tables.

------------------------------------------------------------------------

## 4. Core Database Schema (Supabase / PostgreSQL)

### users

    id
    email
    role (student | mentor | admin)
    created_at

### mentors

    user_id
    max_active_students
    bio
    pricing

### mentorship_products

    id
    mentor_id
    title
    price
    sessions_per_pack = 4
    active

### orders

    id
    user_id
    status (pending | paid | refunded)
    provider (stripe | paypal)
    created_at

### payments

    id
    order_id
    provider
    provider_payment_id
    amount
    currency
    status

### session_packs

    id
    user_id
    mentor_id
    total_sessions = 4
    remaining_sessions
    expires_at
    status (active | depleted | expired | refunded)
    payment_id

### seat_reservations

    id
    mentor_id
    user_id
    session_pack_id
    seat_expires_at
    status (active | grace | released)

### sessions

    id
    mentor_id
    student_id
    scheduled_at
    completed_at
    status (scheduled | completed | canceled)

------------------------------------------------------------------------

## 5. Payment Flow (One‑Time Only)

### Checkout Flow

1.  User selects mentor and session pack
2.  App creates an `order`
3.  User selects:
    -   Stripe Checkout
    -   PayPal Checkout
4.  Redirect to provider‑hosted checkout
5.  Provider sends webhook after payment
6.  System:
    -   Marks order paid
    -   Creates session_pack
    -   Creates seat_reservation
    -   Unlocks booking

### Refund Flow

-   Refund calculated by remaining sessions
-   Stripe/PayPal processes refund
-   Webhook triggers:
    -   session_pack marked refunded
    -   seat released automatically

Refund formula:

    (refundable_sessions / total_sessions) * amount_paid

------------------------------------------------------------------------

## 6. Webhook Events Required

### Stripe

-   checkout.session.completed
-   charge.refunded

### PayPal

-   PAYMENT.CAPTURE.COMPLETED
-   PAYMENT.CAPTURE.REFUNDED

Each webhook must: 1. Validate signature 2. Lookup order_id 3. Update
payment + order 4. Create or update session_pack + seat

------------------------------------------------------------------------

## 7. Seat Reservation Logic

### Seat States

-   active → student in good standing
-   grace → pack used up, grace timer active
-   released → seat freed for new student

### Grace Period

-   Recommended: 72 hours after session 4
-   Renewal during grace preserves seat
-   Expiry auto-releases seat

------------------------------------------------------------------------

## 8. Booking Rules

    Booking Allowed IF:
    remaining_sessions > 0
    AND seat_status = active

When remaining_sessions == 0: - Disable new bookings - Start grace timer

------------------------------------------------------------------------

## 9. Google Calendar Integration

1.  Mentor connects Google via OAuth
2.  Store:
    -   Access token
    -   Refresh token
3.  On session confirmation:
    -   Create Google Calendar event
4.  On session cancel/reschedule:
    -   Update or delete event

------------------------------------------------------------------------

## 10. Discord Bot Automation

Triggers: - Pack purchased → DM mentor + student - Session completed →
update remaining sessions - Session 3 → renewal reminder - Session 4 →
booking disabled + renewal reminder - Grace expiry → seat released +
notifications

------------------------------------------------------------------------

## 11. Video Access Control (Agora / Chime)

Video token issued only if:

    session.status === "scheduled"
    AND remaining_sessions > 0

------------------------------------------------------------------------

## 12. Monorepo Structure

    /apps
      /web        → Next.js Frontend
      /api        → Payments, WEBHOOKS, Packs, Sessions
      /bot        → Discord Bot
      /video      → Agora / Chime Token Service

    /packages
      /db         → Supabase schemas & migrations
      /payments   → Stripe + PayPal adapters
      /calendar   → Google Calendar integration
      /messaging  → Email, Discord, In‑App alerts

------------------------------------------------------------------------

## 13. Development Order (Recommended)

1.  Database schema
2.  Session pack + seat logic
3.  Stripe one‑time checkout
4.  PayPal one‑time checkout
5.  Webhooks
6.  Booking rules
7.  Discord automation
8.  Google Calendar
9.  Video access control

------------------------------------------------------------------------

## 14. Key Design Principles

-   No auto‑billing
-   No subscriptions
-   No credit card storage
-   Provider‑hosted checkout only
-   All access gated by session packs
-   Seats treated as scarce inventory
-   Human‑friendly billing experience

------------------------------------------------------------------------

## 15. Operational Advantages

-   Zero PCI compliance scope
-   Refunds fully provider‑managed
-   No failed recurring payments
-   Mentors fully insulated from billing issues
-   Admin workload reduced drastically

------------------------------------------------------------------------

## 16. Primary Risks (Mitigated)

  Risk            Mitigation
  --------------- ----------------------------
  Chargebacks     Stripe & PayPal mediation
  Seat abuse      Automated seat expiration
  Underpayment    Upfront session pack sales
  Overbooking     Hard seat caps
  Manual errors   Webhook-driven state sync

------------------------------------------------------------------------

## 17. Tooling Stack For Execution

-   Cursor
-   Qwen CLI
-   Gemini CLI
-   Claude Code
-   CodeRabbit

This repository is intentionally designed for AI‑augmented development.

------------------------------------------------------------------------

END OF IMPLEMENTATION PLAN

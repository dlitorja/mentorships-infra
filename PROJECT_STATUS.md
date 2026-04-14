# Mentorship Platform - Project Status & Next Steps

**Last Updated**: December 12, 2025  
**Status**: Payments + Booking + Google Calendar Scheduling Implemented, Security (Arcjet) + Observability (Axiom/Better Stack) Implemented, Onboarding (Email + Form) Implemented, Notifications (Email + Discord) Implemented, Discord Automation (Queue Worker) Implemented

---

## ✅ Completed

### 1. Infrastructure & Setup
- ✅ Monorepo structure (apps/web, apps/bot, apps/video, packages/*)
- ✅ Next.js app with Clerk authentication
- ✅ Drizzle ORM configured
- ✅ Supabase integration
- ✅ TypeScript configuration
- ✅ shadcn/ui components setup
- ✅ Basic routing structure (dashboard, calendar, sessions, settings)

### 2. Database Schema
- ✅ All core tables defined in Drizzle:
  - `users` - User accounts (Clerk integration)
  - `mentors` - Mentor profiles
  - `mentorship_products` - Session packs for sale
  - `orders` - Payment orders
  - `payments` - Payment records
  - `session_packs` - Purchased session packs
  - `seat_reservations` - Seat management
  - `sessions` - Individual mentorship sessions
- ✅ Type-safe database types generated
- ✅ Clerk user sync utility (`getOrCreateUser`)

### 3. Database Migrations
- ✅ Drizzle migrations generated from schema
- ✅ Migrations applied to Supabase database (huckleberry-mentorships)
- ✅ All 8 tables created with correct structure
- ✅ All 7 enums created with correct values
- ✅ Users table configured with text ID for Clerk compatibility
- ✅ Database connection tested and verified
- ✅ **Row Level Security (RLS) enabled on all tables** - Security policies implemented
- ✅ RLS policies created for all tables with proper access controls
- ✅ Performance indexes added for foreign keys

### 4. Documentation
- ✅ Comprehensive implementation plan (`mentorship-platform-plan.md`)
- ✅ Tech stack decisions documented (`KEY_DECISIONS.md`, `TECH_DECISIONS_FINAL.md`)
- ✅ Build readiness checklist
- ✅ Cost breakdown analysis
- ✅ Graphiti memory system configured
- ✅ Testing documentation (`TESTING_CHECKOUT.md`)

### 5. Booking System + Google Calendar Scheduling (CORE FEATURE)
**Status**: ✅ **COMPLETED** - Calendar-driven availability + booking + mentor scheduling settings

**Completed Tasks**:
- [x] Google OAuth connect flow for mentors
- [x] Store mentor calendar auth + scheduling preferences:
  - [x] `mentors.google_refresh_token`, `mentors.google_calendar_id`
  - [x] `mentors.time_zone`, `mentors.working_hours`
- [x] Availability endpoint:
  - [x] `GET /api/mentors/:mentorId/availability` (Google free/busy → bookable slots)
  - [x] Optional filtering by mentor timezone + working hours
- [x] Booking endpoint:
  - [x] `POST /api/sessions` (re-check free/busy, create calendar event, insert session)
  - [x] `sessions.google_calendar_event_id` is unique for idempotency
- [x] Instructor UI:
  - [x] Connect/Reconnect Google Calendar from `/instructor/dashboard`
  - [x] Configure timezone + working hours at `/instructor/settings`
- [x] Student UI:
  - [x] `/calendar` shows bookable slots and books sessions

**Reference**: PR #20 - `feat(booking): add Google Calendar availability and scheduling settings`

### 5. Instructor Session Management (CORE FEATURE)
**Status**: ✅ **COMPLETED** - Full instructor dashboard and session management

**Completed Tasks**:
- [x] Database query functions for mentor session management:
  - [x] `getMentorByUserId()` - Get mentor by Clerk user ID
  - [x] `getMentorById()` - Get mentor by mentor UUID
  - [x] `getMentorUpcomingSessions()` - Get scheduled sessions for a mentor
  - [x] `getMentorPastSessions()` - Get completed/canceled sessions
  - [x] `getMentorSessions()` - Get all sessions for a mentor
- [x] Instructor Dashboard page (`/instructor/dashboard`):
  - [x] Role-based access control (requires `mentor` role)
  - [x] Stats overview: Active students, upcoming sessions, available seats
  - [x] Upcoming sessions list with student information
  - [x] Recent sessions list
  - [x] Active students list with seat status and expiration dates
- [x] Instructor Sessions page (`/instructor/sessions`):
  - [x] View all sessions grouped by status (upcoming vs past)
  - [x] Student information and session details
  - [x] Session notes and recording links
- [x] API route for session management:
  - [x] `PATCH /api/instructor/sessions/[sessionId]` - Update session status
  - [x] Support for status updates: `completed`, `canceled`, `no_show`, `scheduled`
  - [x] Update session notes and recording URLs
  - [x] Authorization: Verifies mentor owns the session
  - [x] Automatic timestamp management (`completedAt`, `canceledAt`)
- [x] Navigation and middleware updates:
  - [x] ProtectedLayout adapts navigation based on user role
  - [x] Mentors see: Instructor Dashboard, My Sessions, Settings
  - [x] Students see: Dashboard, Sessions, Calendar, Settings
  - [x] Middleware protects `/instructor/*` routes

**Completed Components**:
- ✅ Mentor query functions (`packages/db/src/lib/queries/mentors.ts`)
- ✅ Extended session queries (`packages/db/src/lib/queries/sessions.ts`)
- ✅ Instructor Dashboard page (`apps/web/app/instructor/dashboard/page.tsx`)
- ✅ Instructor Sessions page (`apps/web/app/instructor/sessions/page.tsx`)
- ✅ Session management API (`apps/web/app/api/instructor/sessions/[sessionId]/route.ts`)
- ✅ Role-based navigation (`apps/web/components/navigation/protected-layout.tsx`)

**Estimated Time**: 1 day (completed)

**Reference**: PR #10 - `feat(instructor): add instructor session management dashboard and API`

---

### 6. Stripe Payment Integration (CORE FEATURE)
**Status**: ✅ **COMPLETED** - Fully implemented with Inngest functions

**Completed Tasks**:
- [x] Stripe adapter package created (`packages/payments/src/stripe/`):
  - [x] `client.ts` - Stripe client setup with environment validation
  - [x] `checkout.ts` - Checkout session creation with metadata support
  - [x] `webhooks.ts` - Webhook signature verification and parsing
  - [x] `refunds.ts` - Refund processing with amount calculation
  - [x] `types.ts` - TypeScript type definitions
- [x] Checkout API endpoint:
  - [x] `POST /api/checkout/stripe` - Create Stripe checkout session
  - [x] `GET /api/checkout/verify` - Verify checkout session
  - [x] Additional routes: success, cancel
- [x] Webhook handler:
  - [x] `POST /api/webhooks/stripe` - Handle Stripe webhooks with signature verification
  - [x] `checkout.session.completed` - Processed via Inngest (creates pack, seat, payment)
  - [x] `charge.refunded` - Processed via Inngest (releases seat, updates pack status)
- [x] Idempotency checks implemented:
  - [x] Order status check (prevents duplicate processing)
  - [x] Payment existence check (prevents duplicate payment records)
  - [x] Session pack existence check (prevents duplicate packs)
  - [x] Seat reservation existence check (prevents duplicate reservations)
- [x] Webhook signature verification (CRITICAL security feature)
- [x] Error handling and logging:
  - [x] Order cleanup on checkout failure
  - [x] Comprehensive error messages
  - [x] Inngest retry logic (3 retries with exponential backoff)
- [x] Additional features:
  - [x] Grandfathered pricing support
  - [x] Promotion code support (customer-entered and auto-applied)
  - [x] Discount tracking (original amount, discount amount, discount code)
  - [x] Order metadata tracking (order_id, user_id, pack_id)

**Completed Components**:
- ✅ Stripe payments package (`packages/payments/`)
- ✅ Checkout API route (`apps/web/app/api/checkout/stripe/route.ts`)
- ✅ Webhook handler (`apps/web/app/api/webhooks/stripe/route.ts`)
- ✅ Inngest payment processing functions (`apps/web/inngest/functions/payments.ts`):
  - ✅ `processStripeCheckout` - Handles checkout.session.completed
  - ✅ `processStripeRefund` - Handles charge.refunded
- ✅ Event types and schemas (`apps/web/inngest/types.ts`)
- ✅ Stripe client library (`apps/web/lib/stripe.ts`)

**Estimated Time**: 3-4 days (completed)

**Reference**: See `TECH_DECISIONS_FINAL.md` for implementation details, `TESTING_CHECKOUT.md` for testing guide

---

### 7. Platform-wide Security & Rate Limiting (Arcjet)
**Status**: ✅ **COMPLETED** - Platform-wide protection via middleware policy matrix

**Completed Tasks**:
- [x] Arcjet integrated (`@arcjet/next`) in `apps/web`
- [x] Centralized enforcement in `apps/web/middleware.ts` for `/api/*` (excluding `/api/health` and `/api/inngest/*`)
- [x] Policy matrix implemented in `apps/web/lib/arcjet.ts`:
  - `default`, `user`, `auth`, `checkout`, `booking`, `availability`, `instructor`, `forms`, `webhook`
- [x] Verified runtime enforcement (429/403) on production deployments

**Reference**: PR #22 - `feat(security): add Arcjet protection in middleware`

---

### 8. Observability & Error Tracking (Axiom + Better Stack)
**Status**: ✅ **COMPLETED** - Dual-provider observability for errors + security signals

**Completed Tasks**:
- [x] Centralized reporting utility: `apps/web/lib/observability.ts`
- [x] Arcjet protect failures report to Axiom/Better Stack (fail-open) via `apps/web/lib/arcjet.ts`
- [x] Client error forwarding endpoint `/api/errors` forwards to Better Stack + Axiom via server-side token usage
- [x] `/api/errors` is public (still Arcjet-protected) so client-side error reporting doesn’t 401

**Env Vars**:
- Axiom: `AXIOM_TOKEN`, `AXIOM_DATASET`, `AXIOM_INGEST_URL`
- Better Stack: `BETTERSTACK_SOURCE_TOKEN`

**Reference**: PR #23 - `fix(observability): forward errors to Axiom and Better Stack`

---

### 9. Onboarding (Purchase Email + Form)
**Status**: ✅ **COMPLETED** - Purchase onboarding email + onboarding submissions workflow

**Completed Tasks**:
- [x] Purchase onboarding email sent after mentorship purchase (instructor name + onboarding link + Discord join CTA + support contact)
- [x] Mentee onboarding form (goals + 2–4 images)
- [x] Secure uploads to Supabase Storage bucket `mentorship_onboarding`
- [x] Secure viewing via signed URLs
- [x] Instructor onboarding review UI + “mark reviewed” endpoint
- [x] Discord actions queued in `discord_action_queue` for future bot automation

**Reference**: PR #27 - `feat(web): mentorship onboarding + purchase email`

---

## 🚧 In Progress / Next Steps

### Priority 1: Notifications & Automation (Discord + Email)
**Status**: ✅ **COMPLETED** - Email + Discord delivery implemented; Discord automation queue worker implemented

**Current state**:
- ✅ Email delivery via Resend exists for `notification/send` (renewals/grace warnings can be emailed).
- ✅ Purchase onboarding email is sent after mentorship purchase.
- ✅ Discord DM delivery exists for `notification/send` when the user has linked Discord and `DISCORD_BOT_TOKEN` is configured.
- ✅ Inngest worker consumes `discord_action_queue` (role assignment + instructor DMs).

**Tasks**:
- [x] Implement Discord delivery for `notification/send` (renewals, grace warnings)
- [x] Implement an Inngest worker to consume `discord_action_queue`:
  - [x] Assign mentee role when Discord is connected
  - [x] DM instructor on new purchase (queued by onboarding)
- [x] Add idempotency/deduplication for queued Discord actions (safe claim + lock TTL)

**Env Vars (Discord)**:
- `DISCORD_BOT_TOKEN` (required for sending DMs + role assignment)
- `DISCORD_GUILD_ID` (required for role assignment if not supplied in payload)
- `DISCORD_MENTEE_ROLE_NAME` (required for role assignment unless using roleId)

**Estimated Time**: 2-4 days

---

### Priority 6: Discord Bot Automation
**Status**: Core automation runs via Inngest + `discord_action_queue`; `apps/bot` slash commands still not implemented

**Tasks**:
- [ ] Set up Discord bot commands:
  - [ ] `/pack-purchased` - Notify mentor + student
  - [ ] `/session-completed` - Update remaining sessions
  - [ ] `/renewal-reminder` - Send when session 3 completed
  - [ ] `/grace-warning` - Send 12h before seat release
- [ ] Create event listeners:
  - [ ] Listen to webhook events (pack purchased)
  - [ ] Listen to session completion events
  - [ ] Schedule grace period reminders
- [ ] Integrate with messaging package

**Estimated Time**: 2-3 days

---

### Priority 7: Google Calendar Integration
**Status**: ✅ **COMPLETED** - Implemented via booking system (see completed section above)

---

### Priority 8: Mentorship Workspace (Notes + Links + Images)
**Status**: ⏳ NEXT

**Goal**: Add a mentorship-wide shared space (per active mentorship) where mentees and instructors can:
- Record notes and share links (both can read; only authors can edit/delete their own entries)
- Upload images:
  - Mentee cap: 75 images per mentorship
  - Mentor cap: 150 images per mentorship
- “Download all images” (mentee downloads a ZIP containing ALL images in the workspace, including instructor uploads)

**Retention policy**:
- Delete ALL workspace content (notes + links + images) **18 months after mentorship ends**
- “Mentorship ends” is defined as when the **seat reservation is released** (`seat_reservations.status = released`)
- Notify mentees ahead of deletion at **90 / 30 / 7 days** (email + in-app banner) with a one-click “Download all” button
- No need to notify instructors about deletion

---

### Priority 9: Video Access Control (Agora)
**Status**: App structure exists, not implemented

**Tasks**:
- [ ] Set up Agora account
- [ ] Create token generation service (`apps/video`)
- [ ] Implement access control:
  - [ ] Check `session.status === "scheduled"`
  - [ ] Check `remaining_sessions > 0`
- [ ] Integrate with video call UI

**Estimated Time**: 1-2 days

---

## 📋 Development Order (Recommended)

Based on the plan in `mentorship-platform-plan.md`:

1. ✅ **Database schema** - DONE
2. ✅ **Database migrations** - DONE (applied to Supabase)
3. ✅ **Session pack + seat logic** - DONE (implemented with Inngest functions)
4. ✅ **Stripe one-time checkout** - DONE (fully implemented with webhooks)
5. ✅ **Stripe Webhooks** - DONE (integrated with Inngest)
6. ✅ **Instructor Session Management** - DONE (dashboard, sessions page, API)
7. ✅ **PayPal one-time checkout** - DONE (fully implemented with webhooks)
8. ✅ **Booking system + Google Calendar scheduling** - DONE (availability + booking + settings)
9. ✅ **Platform-wide security/rate limiting** - DONE (Arcjet middleware policy matrix)
10. ✅ **Observability** - DONE (Axiom + Better Stack)
11. ✅ **Onboarding (email + form)** - DONE (purchase email + onboarding submissions)
12. ✅ **Discord automation + expanded notifications** - DONE (consume `discord_action_queue`, Discord delivery for `notification/send`)
13. ⏳ **Mentorship workspace (notes + links + images)** - NEXT (HIGHER PRIORITY THAN AGORA)
14. ⏳ **Video access control** - After #13

---

## 🎯 Immediate Next Steps

1. **✅ Session pack & seat logic** (completed with Inngest functions)
2. **✅ Stripe payment integration** (completed - core revenue feature)
3. **✅ Instructor session management** (completed - dashboard, sessions page, API)
4. **✅ PayPal integration** (secondary payment option) - COMPLETED
5. ✅ **Row Level Security (RLS) enabled** - All tables secured with proper policies
6. ✅ **Arcjet platform-wide security/rate limiting** (middleware policy matrix)
7. ✅ **Observability (Axiom + Better Stack)** (errors + Arcjet failures)
8. **Discord automation + expanded notifications**
   - Consume `discord_action_queue` for mentee role assignment + instructor DMs
   - Add Discord delivery for `notification/send` events (renewals, grace warnings, session reminders)
   - Keep idempotency/dedupe guarantees (queue locks + existing seat warning dedupe)


---

## 📚 Key Reference Documents

- `docs/plans/README.md` - Canonical feature plans index
- `docs/plans/mentorship-workspaces-v1.md` - Mentorship workspace spec (notes/links/images/export/retention)
- `mentorship-platform-plan.md` - Overall architecture and business model
- `TECH_DECISIONS_FINAL.md` - Step-by-step Stripe/PayPal implementation guide
- `TESTING_CHECKOUT.md` - Stripe checkout testing guide
- `KEY_DECISIONS.md` - Tech stack decisions
- `BUILD_READINESS_CHECKLIST.md` - Pre-build checklist
- `.cursorrules` - Development guidelines and preferences

---

## 🔍 Quick Status Check

Run these commands to check current state:

```bash
# Check database migrations
cd packages/db
pnpm generate  # Generate migrations
pnpm migrate   # Apply migrations (if Supabase MCP available)

# Check if Stripe package exists
ls packages/payments/src

# Check API routes
ls apps/web/app/api
```

---

**Next**: Mentorship workspace (notes + links + images), then video access control (Agora).

---

## 📊 Recent Progress Summary

### December 2024
- ✅ **PayPal Payment Integration** (PR #11)
  - Complete PayPal payment integration with Orders API
  - Webhook handlers for payment capture and refund events
  - Inngest functions for async payment processing
  - All PR review comments addressed and fixes applied
  - Full type safety and idempotency checks implemented
- ✅ **Instructor Session Management** (PR #10)
  - Complete instructor dashboard with stats and session lists
  - Session management API with role-based authorization
  - Role-adaptive navigation system
  - Full type safety with Drizzle ORM and Zod validation


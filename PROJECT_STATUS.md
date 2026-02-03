# Mentorship Platform - Project Status & Next Steps

**Last Updated**: February 2, 2026  
**Status**: Payments + Booking + Google Calendar Scheduling Implemented, Security (Arcjet) + Observability (Axiom/Better Stack) Implemented, Email Notifications Implemented, Instructor/Mentee Dashboards in apps/marketing (No Payments), **Admin Dashboard for Instructors & Mentees Implemented**, Ready for Discord Automation + Video Access Control

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

### 9. Email Notifications (Resend + Inngest)
**Status**: ✅ **COMPLETED** - Transactional email delivery for `notification/send` events

**Completed Tasks**:
- [x] Inngest notification delivery handler implemented: `apps/web/inngest/functions/notifications.ts` (`handleNotificationSend`)
- [x] Handler registered with Inngest: `apps/web/app/api/inngest/route.ts`
- [x] Resend email sender implemented: `apps/web/lib/email.ts`
- [x] Email templates implemented: `apps/web/lib/notifications/notification-email.ts`
- [x] Verified end-to-end in production: **Inngest run → Resend logs → inbox delivery**
- [x] Reply-to configured without additional Google Workspace seats:
  - Google Workspace Group `support@huckleberry.art` forwards to `huckleberryartinc@gmail.com`

**Env Vars**:
- `RESEND_API_KEY`
- `EMAIL_FROM="Huckleberry Mentorships <noreply@mentorships.huckleberry.art>"`
- `EMAIL_REPLY_TO="Support <support@huckleberry.art>"`
- `NEXT_PUBLIC_URL` (or `VERCEL_URL`) for links inside emails

**Reference**: PR #25 - `feat(web): send email notifications for notification/send events`

---

### 10. Instructor & Mentee Dashboards in apps/marketing (No Payment Integration)
**Status**: ✅ **COMPLETED** - Instructor/mentee dashboards without Stripe/PayPal dependencies

**Completed Tasks**:
- [x] Database query functions for mentor-mentee session tracking (`packages/db/src/lib/queries/sessionPacks.ts`):
  - [x] `getMentorMenteesWithSessionInfo()` - Get all mentees with session counts, last session date, expiration
  - [x] `getMentorMenteesWithLowSessions()` - Get mentees with only 1 session remaining
  - [x] `getUserInstructorsWithSessionInfo()` - Get all instructors for a mentee with session details
  - [x] `getUserLowSessionPacks()` - Get session packs with 1 session remaining
  - [x] `addSessionsToPack()` / `removeSessionsFromPack()` - Manual session management (admin use)
- [x] Mentee Dashboard page (`/dashboard`):
  - [x] Shows all instructors with session counts and last session dates
  - [x] Amber alert banner when 1 session remaining with renewal reminder message
  - [x] Stats: total sessions, active instructors, low session alerts
  - [x] Quick actions to browse instructors or schedule sessions
  - [x] Discord connection reminder if not connected
- [x] Instructor Dashboard page (`/instructor/dashboard`):
  - [x] Role-based access control (requires `mentor` role)
  - [x] Shows all mentees with session counts and last session dates
  - [x] Amber alert section highlighting mentees with 1 session remaining (sticky CTA for instructors to encourage renewals)
  - [x] Stats: active mentees, low session alerts, total sessions used, sessions remaining across all mentees
  - [x] Renewal encouragement prompts for instructors with 1-session-remaining mentees
- [x] Authentication setup in apps/marketing:
  - [x] Clerk authentication configured (already existed in layout)
  - [x] Role-based auth helpers (`requireRole`, `requireDbUser`, etc.)
  - [x] Discord linking indicator (via Clerk's external accounts)
- [x] UI component updates:
  - [x] Added `warning` variant to Badge component for amber alerts

**Key Design Decisions**:
- No payment integration - uses existing session/sessionPack tables only
- Manual session management via `addSessionsToPack()` / `removeSessionsFromPack()` for admin use
- Renewal reminders displayed prominently for both instructors and mentees
- Instructors get specific mentee list to reach out to for renewals (sticky CTA)

**Completed Components**:
- ✅ Extended session pack queries (`packages/db/src/lib/queries/sessionPacks.ts`)
- ✅ Mentee Dashboard (`apps/marketing/app/dashboard/page.tsx`)
- ✅ Instructor Dashboard (`apps/marketing/app/instructor/dashboard/page.tsx`)
- ✅ Auth helpers (`apps/marketing/lib/auth.ts`)
- ✅ Badge warning variant (`apps/marketing/components/ui/badge.tsx`)
- ✅ Path alias configured (`@mentorships/db` → `../../packages/db/src`)

**Estimated Time**: 1 day (completed)

---

### 11. Admin Dashboard: Instructors & Mentees
**Status**: ✅ **COMPLETED** - Admin oversight view for instructors and their mentees

**Completed Tasks**:
- [x] Database query functions for admin oversight (`packages/db/src/lib/queries/admin.ts`):
  - [x] `getAllInstructorsWithStats()` - Get all instructors with mentee counts, completed sessions, inventory
  - [x] `getInstructorWithMentees()` - Get detailed mentee info with session counts, last session dates, seat status
  - [x] `getFullAdminCsvData()` - Export all instructor-mentee relationships for CSV reporting
- [x] API routes for admin instructor management (`apps/marketing/app/api/admin/instructors/`):
  - [x] `GET /api/admin/instructors` - List instructors with search, pagination, and stats
  - [x] `GET /api/admin/instructors/[id]/mentees` - Get mentees for a specific instructor
  - [x] `GET /api/admin/instructors/csv` - Export full CSV report of all instructor-mentee relationships
- [x] Admin Instructors page (`/admin/instructors`):
  - [x] Table showing: Instructor email, Active Mentees count, Total Sessions Completed, Inventory, Join Date
  - [x] Expandable rows to view all mentees for each instructor
  - [x] Mentee details: Email, Sessions (completed/total), Remaining Sessions, Pack Status, Last Session Date, Seat Status
  - [x] Search by instructor email
  - [x] Pagination support (for future scalability beyond 50 instructors)
  - [x] CSV Export button for full report download
- [x] Navigation updates:
  - [x] Added "Instructors" link to admin sidebar
  - [x] Added "View Instructors" quick action card on admin dashboard

**Completed Components**:
- ✅ Admin queries (`packages/db/src/lib/queries/admin.ts`)
- ✅ Instructors list API (`apps/marketing/app/api/admin/instructors/route.ts`)
- ✅ Instructor mentees API (`apps/marketing/app/api/admin/instructors/[id]/mentees/route.ts`)
- ✅ CSV export API (`apps/marketing/app/api/admin/instructors/csv/route.ts`)
- ✅ Instructors page (`apps/marketing/app/admin/instructors/page.tsx`)
- ✅ Interactive table component (`apps/marketing/components/admin/instructors-table.tsx`)
- ✅ Sidebar navigation update (`apps/marketing/components/admin/admin-sidebar.tsx`)
- ✅ Dashboard quick link (`apps/marketing/app/admin/page.tsx`)

**Features**:
- Search instructors by email
- View active mentee count and total completed sessions per instructor
- Expand to see all mentees with remaining session counts and last session dates
- Export full CSV report with instructor-mentee relationships
- Pagination ready for future scalability

**Estimated Time**: 0.5 days (completed)

---

## 🚧 In Progress / Next Steps

### Priority 1: Notifications & Automation (Discord + Email)
**Status**: 🚧 **IN PROGRESS** - Discord remaining (email complete)

**Tasks**:
- [ ] Wire Discord bot notifications for: pack purchased, renewal reminders, grace warnings, session reminders
- [x] Add email provider (Resend) + templates for transactional emails
- [ ] Centralize notification events (Inngest) and ensure idempotency/deduplication

**Estimated Time**: 1-3 days (Discord + polish)

---

### Priority 6: Discord Bot Automation
**Status**: Bot structure exists, automation not implemented

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

### Priority 8: Video Access Control (Agora)
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
11. ✅ **Notifications & automation** - DONE (email complete; Discord pending)
12. ✅ **Instructor/Mentee Dashboards in apps/marketing** - DONE (no payment integration)
13. ✅ **Admin Dashboard: Instructors & Mentees** - DONE (oversight view with CSV export)
14. ⏳ **Discord notification delivery** - NEXT (connect Discord bot to `notification/send` events)
15. ⏳ **Video access control** - After Discord (Agora)

---

## 🎯 Immediate Next Steps

1. **✅ Session pack & seat logic** (completed with Inngest functions)
2. **✅ Stripe payment integration** (completed - core revenue feature)
3. **✅ Instructor session management** (completed - dashboard, sessions page, API)
4. **✅ PayPal integration** (secondary payment option) - COMPLETED
5. ✅ **Row Level Security (RLS) enabled** - All tables secured with proper policies
6. ✅ **Arcjet platform-wide security/rate limiting** (middleware policy matrix)
7. ✅ **Observability (Axiom + Better Stack)** (errors + Arcjet failures)
8. ✅ **Instructor/Mentee Dashboards in apps/marketing** (no payment integration) - COMPLETED
9. ✅ **Admin Dashboard: Instructors & Mentees** - COMPLETED (oversight view with search, expand mentees, CSV export)
10. **Implement Discord notification delivery** (connect Discord bot to `notification/send` events; email complete)
11. **Implement video access control** (Agora for video calls)

---

## 📚 Key Reference Documents

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

**Priority 1, 2, 4 Complete! Ready to proceed with Priority 5: Booking System** 🚀

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

### February 2026
- ✅ **Instructor & Mentee Dashboards in apps/marketing** (This PR)
  - Built instructor/mentee dashboards in apps/marketing without payment integration
  - Database queries for mentor-mentee session tracking (mentees with session counts, last session dates)
  - Mentee dashboard showing all instructors with session counts and 1-session renewal reminders
  - Instructor dashboard showing all mentees with session counts and renewal CTAs for 1-session mentees
  - Manual session management functions (addSessionsToPack, removeSessionsFromPack) for admin use
  - Auth helpers configured for role-based access control
  - Amber warning badges for low-session alerts
  - All builds pass successfully

- ✅ **Admin Dashboard: Instructors & Mentees** (February 2026)
  - Admin oversight view for all instructors with their mentees
  - Database queries for admin reporting (`getAllInstructorsWithStats`, `getInstructorWithMentees`, `getFullAdminCsvData`)
  - API routes: list instructors with search/pagination, get instructor mentees, CSV export
  - Interactive table with expandable rows showing all mentees per instructor
  - Mentee details: sessions used/remaining, pack status, last session date, seat status
  - CSV export of all instructor-mentee relationships
  - Search by instructor email, pagination ready for future scalability
  - Added to admin sidebar and dashboard quick actions


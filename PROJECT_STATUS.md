# Mentorship Platform - Project Status & Next Steps

## 🔴 Top Priority

### Fix Payment Flow Reads to Convex (IN PROGRESS)

**Issue**: Payment writes go to Convex, but some reads still go to SQL causing payment flow to fail.

**Impact**: Onboarding emails won't send, student/instructor dashboards won't show purchase data.

**Fix Plan** (in priority order):
1. ~~**Phase 1**: Fix `onboardingFlow` to read from Convex (CRITICAL - blocks all payment flows)~~ ✅ COMPLETED
2. ~~**Phase 2**: Fix student dashboard reads to Convex~~ ✅ COMPLETED
3. **Phase 3**: Fix instructor dashboard reads to Convex
4. **Phase 4**: Verify payment flow end-to-end

**Reference**: `PAYMENT_FLOW_TESTING_INSTRUCTIONS.md` for testing guide once complete.

- ~~Migrate instructor image storage to Convex Storage~~ ✅ **COMPLETED April 30, 2026**
  - ~~Replace Supabase Storage usage for instructor profile and portfolio images with Convex `ctx.storage`~~ ✅
  - ~~Store Convex `storageId` in instructor records and resolve URLs with `ctx.storage.getUrl`~~ ✅
  - ~~Update admin upload flows and instructor dashboards to use Convex mutations~~ ✅
  - ~~Batch migration: import existing images into Convex storage and backfill references~~ ✅
    - **65 images migrated** (10 instructor profiles + 48 portfolio images + 7 mentee results)
    - Storage IDs now populated in `instructors`, `instructorProfiles`, and `menteeResults` tables
    - Supabase Storage images retained as backup (dual-write during transition)

**Last Updated**: May 10, 2026 (Phase 2 COMPLETE - Student dashboard + onboarding now use Convex)
**Status**: AI Crawl Control Implemented, Convex Migration Complete - Convex Schema + Query/Mutation Functions Complete, Payments + Booking + Google Calendar Scheduling Implemented, Security (Upstash/Redis) + Observability (Axiom/Better Stack) Implemented, Onboarding (Email + Form) Implemented, Notifications (Email + Discord) Implemented, Discord Automation (Queue Worker) Implemented, Instructor Management (Admin + Dashboard) Implemented, Manual Session Count Tracking (Kajabi Mentees) Implemented, **Workspace UI (Chat + Notes + Images) Implemented**, **ZIP Export for Workspace Images + Notes Implemented**, **Admin Workspace Access (Dual Workspaces + Audit Logging) COMPLETED**, **Inventory Management COMPLETE**, **Waitlist System COMPLETE**, **Mentor → Instructor Terminology Migration (Frontend User-Facing Strings COMPLETE)**, **Workspace Retention Warning Banner COMPLETE**, **Phase 2 Data Migration: COMPLETE**, **Mentor → Instructor Convex Function Naming Cleanup (Option B): COMPLETE**, **Convex Payment Processing Migration: COMPLETE** (PR #198), **Instructor Image Storage to Convex Storage Migration: COMPLETE**, **Phase 4B (Instructor/Public Routes) Migration: COMPLETE** (PR #205), **Phase 4D (User Settings + Type Fixes): COMPLETE** (PR #205), **Phase 4E-1 (Admin Low-Risk Routes): COMPLETE** (PR #206), **Phase 4E-2 (Admin Medium-Risk Routes): DEFERRED**, **Phase 4E-3 (Admin Instructor Sub-Routes): COMPLETE** (PR #209), **Workspace Pairing After Purchase: COMPLETE** (PR #213), **Admin Purchase Email Notifications: COMPLETE** (PR #213), **Grace Period Extended to 7 Days** (PR #213), **Phase 4E-4 (Admin Stats + Lists): COMPLETE** (PR #232), **Admin Products GET SQL Migration: COMPLETE**, **SQL Pagination Bugfix** (PR #233), **Convex ID Resolution Migration: COMPLETE** (PR #234), **Phase 3A (Inngest → Convex Simple Functions): COMPLETE** (PR #236), **Phase 3B (Inngest → Convex Medium Functions): COMPLETE**, Discord Bot Slash Commands NOT_STARTED, Video Access Control NOT_STARTED

---

## 🏗️ Architecture Clarification

### Application Responsibilities

| App | Responsibility |
|-----|---------------|
| **apps/marketing** | Public-facing marketing site, instructor profiles (`/instructors`), landing pages |
| **apps/web** | Dashboards (admin, instructor, mentee), payment flow (Stripe/PayPal), calendar booking |
| **apps/bot** | Discord bot (slash commands, automation) |
| **apps/video** | Video integration (Agora/Amazon Chime) |

### Database Architecture - Source of Truth Principle

**CRITICAL**: This architecture must NOT be violated. Straying from this causes repeated work and data inconsistencies.

#### Data Store Selection Rule

| Data Type | Source of Truth | When to Use |
|-----------|-----------------|-------------|
| **Payment data** (orders, payments, sessionPacks, mentors, instructors, workspaces) | **Convex** | User-facing reads, real-time reactivity, payment processing |
| **Analytics/Stats** (aggregations, reports, admin dashboards requiring complex joins) | **SQL/Drizzle** | Admin stats, revenue calculations, seat utilization analytics |
| **User content** (instructor profiles, testimonials, mentee results) | **Convex** | Real-time updates, admin management |
| **Historical/migrated data** | **Once to Convex** | One-time migration, never touched again |

#### Why This Separation?

**Convex excels at**:
- Real-time reactive queries (dashboard auto-refreshes)
- Complex authorization (row-level security via Convex queries)
- Payment transaction handling (idempotent mutations)
- User-facing data that needs consistency across clients

**SQL/Drizzle excels at**:
- Complex aggregations (SUM, COUNT, GROUP BY across large datasets)
- Analytics queries that scan many rows for reporting
- Admin-only dashboards that don't need real-time updates

#### What MUST NOT Happen

- ❌ **Do NOT sync Convex payment data to SQL** - creates failure points, lag, and divergence
- ❌ **Do NOT read payment data from SQL if it was written to Convex** - will find nothing
- ❌ **Do NOT write payment data to both** - sync will eventually fail
- ❌ **Do NOT use SQL for user-facing real-time queries** - loses reactivity benefits

#### Current Migration Status

| Data Type | Source | Status |
|-----------|--------|--------|
| Orders | Convex | ✅ Write + Read |
| Payments | Convex | ✅ Write + Read |
| Session Packs | Convex | ✅ Write + Read |
| Instructors/Mentors | Convex | ✅ Write + Read |
| Products | Convex | ✅ Write + Read |
| Seat Reservations | Convex | ✅ Write + Read |
| Workspaces | Convex | ✅ Write + Read |
| Admin Stats | SQL/Drizzle | ✅ Read (analytics appropriate) |
| Admin Orders (list) | Convex | ✅ Read (PR #232) |
| Admin Products (list) | Convex | ✅ Read (PR #232) |

---

### Data Flow

**apps/marketing**:
- Reads instructor data from **Convex** via `@mentorships/db` queries

**apps/web**:
- Payment data (orders, payments, sessionPacks): **Convex** (source of truth)
- Analytics/stats: **SQL/Drizzle** (Supabase)
- Auth via Clerk, file storage via Convex Storage
- Video recordings on Backblaze B2 with Cloudflare egress

---

## ✅ Completed

### 0. AI Crawl Control (Cloudflare)
- ✅ robots.txt created at `apps/marketing/public/robots.txt`:
  - Allows search engines (Googlebot, Bingbot, DuckDuckBot, Yandex, Baiduspider)
  - Blocks AI training crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.)
  - Disallows private routes (/admin/, /instructor/, /dashboard/, /api/)
- ✅ sitemap.xml created at `apps/marketing/public/sitemap.xml`
- ⏳ Cloudflare Dashboard: Toggle AI Crawl Control ON

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

### 7. Platform-wide Security & Rate Limiting (Upstash/Redis)
**Status**: ✅ **COMPLETED** - Platform-wide protection via middleware policy matrix

**Completed Tasks**:
- [x] Upstash Redis-based rate limiting integrated in `apps/web`
- [x] Centralized enforcement in `apps/web/proxy.ts` for `/api/*`
- [x] Policy matrix implemented in `apps/web/lib/ratelimit.ts`:
  - `default`, `user`, `auth`, `checkout`, `booking`, `availability`, `instructor`, `forms`, `webhook`, `admin`
- [x] Dual-window rate limiting (short-term + long-term)
- [x] Verified runtime enforcement (429/403) on production deployments

**Reference**: Custom implementation using Upstash Redis (replaced earlier Arcjet approach)

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

### 10. Instructor Management (Admin + Dashboard)
**Status**: ✅ **COMPLETED** - Full CRUD for instructors via admin UI, instructor dashboard for testimonials and mentee results

**Completed Tasks**:
- [x] Database tables created in Supabase:
  - `instructors` - Instructor profiles (name, slug, tagline, bio, specialties, background, images, socials)
  - `instructor_testimonials` - Linked testimonials
  - `mentee_results` - Before/after images linked to instructors
- [x] Drizzle query functions (`packages/db/src/lib/queries/instructors.ts`)
- [x] Admin API routes:
  - `GET/POST /api/admin/instructors` - List and create
  - `GET/PUT/DELETE /api/admin/instructors/[id]` - CRUD single instructor
  - `POST /api/admin/instructors/[id]/testimonials` - Add testimonial
  - `DELETE /api/admin/instructors/[id]/testimonials/[testimonialId]` - Delete testimonial
  - `POST /api/admin/instructors/[id]/mentee-results` - Add mentee result
  - `DELETE /api/admin/instructors/[id]/mentee-results/[resultId]` - Delete mentee result
- [x] Instructor dashboard API routes:
  - `GET/POST /api/instructor/testimonials` - Manage own testimonials
  - `GET/POST /api/instructor/mentees-results` - Manage own mentee results
  - `DELETE /api/instructor/mentees-results/[id]` - Delete own mentee result
- [x] Admin pages:
  - `/admin/instructors` - List view with search, filter by active/inactive
  - `/admin/instructors/create` - Create form with tabs (Basic Info, Images, Tags, Social, Review)
  - `/admin/instructors/[id]/edit` - Edit form with tabs + testimonials + mentee results management
- [x] Instructor dashboard updates:
  - Added testimonials section - add/remove testimonials
  - Added mentee results section - add/remove before/after images
- [x] Features:
  - Predefined tags (specialties, background) + custom tags
  - Social links: Twitter, Instagram, YouTube, Bluesky, Website, ArtStation
  - Profile picture + portfolio images (URL input)
  - Testimonials with name + text
  - Mentee results with image URL + optional student name

**Estimated Time**: 2-3 days (completed)

---

### 11. Manual Session Count Tracking (Kajabi Mentees)
**Status**: ✅ **COMPLETED** - Manual session tracking for mentees who paid through Kajabi (not through app's Stripe/PayPal)

**Completed Tasks**:
- [x] New database table `mentee_session_counts`:
  - `id`, `user_id`, `instructor_id`, `session_count`, `notes`, timestamps
  - UNIQUE constraint on `(user_id, instructor_id)` to prevent duplicates
  - Foreign keys to `users` and `instructors` tables
- [x] Drizzle query functions (`packages/db/src/lib/queries/menteeSessionCounts.ts`):
  - `getSessionCountsForMentee()` - Get all counts for a mentee
  - `getSessionCountForInstructorMentee()` - Get specific instructor/mentee pair
  - `createSessionCount()`, `updateSessionCount()`, `adjustSessionCount()`
  - `upsertSessionCount()` - Atomic upsert with uniqueness handling
  - `deleteSessionCount()` - Remove session count records
- [x] Admin API routes (`/api/admin/mentees/[userId]/session-count`):
  - `GET` - List all session counts for a mentee
  - `POST` - Create/upsert session count (sets total)
  - `PATCH` - Adjust session count (add/subtract) or update total
  - `DELETE` - Remove session count record
- [x] Instructor API routes (`/api/instructor/mentees/session-counts/[userId]`):
  - `GET` - Get session count for own mentee
  - `POST` - Create/upsert for own mentee
  - `PATCH` - Adjust session count for own mentee
  - Authorization: verifies instructor owns the mentee relationship
- [x] Admin UI (`/admin/mentees`):
  - Added "Set Sessions" button to manually set session counts
  - Input validation: rejects non-integer, negative, or empty values
  - Uses `Number.isInteger()` to catch ambiguous input like "2abc", "1.5"
  - Query invalidation after update to refresh UI

**Security Fixes** (during review):
- [x] BOLA vulnerability fixed - Instructor PATCH now verifies record ownership
- [x] Race condition fixed - `adjustSessionCount` uses atomic SQL update
- [x] Unique constraint added - Prevents duplicate `(user_id, instructor_id)` pairs

**Reference**: PR #137 - `feat: add manual session count tracking for mentees`

---

### 12. Convex Migration (Database + Real-time)
**Status**: 🚧 **IN PROGRESS** - Migrating from Supabase/PostgreSQL to Convex

**Goal**: Replace Supabase with Convex for database, real-time queries, and file storage while keeping other services unchanged.

**Rationale**:
- Real-time by default (no polling needed for notes, messages, images)
- Simpler DX (no API routes, direct database queries)
- Built-in file storage for workspace images
- Clerk integration works seamlessly
- Free tier sufficient initially (1M calls/month, 0.5GB DB, 1GB storage)

**Phase 1: Setup - COMPLETED** ✅
- [x] Installed `convex` package to workspace
- [x] Initialized Convex project (`npx convex init`)
- [x] Created `convex.config.ts` with auth configuration
- [x] Created `convex/auth.config.ts` with Clerk JWT issuer
- [x] Created `convex/schema.ts` with basic users table (email index)
- [x] Created `convex/users.ts` with test queries
- [x] Created `ConvexClientProvider` component for Next.js
- [x] Updated `apps/web/app/layout.tsx` to include Convex provider
- [x] Set `CLERK_JWT_ISSUER_DOMAIN` in Convex environment
- [x] Verified build succeeds with Convex integration

**Files Created/Modified**:
- `convex.config.ts` - Convex configuration
- `convex/auth.config.ts` - Clerk auth integration
- `convex/schema.ts` - Database schema (users table)
- `convex/users.ts` - Test queries
- `apps/web/components/convex-client-provider.tsx` - Client provider (NEW)
- `apps/web/app/layout.tsx` - Updated with Convex provider
- `.env.local` - Added Convex and NEXT_PUBLIC_CONVEX_URL
- `.env` - Added CLERK_JWT_ISSUER_DOMAIN

**Current Status**:
- Local Convex deployment running at `http://127.0.0.1:3210`
- Schema pushed: 16 tables with indexes
- Build verified successful
- Phase 2 (Schema Translation) COMPLETED ✅
- Phase 3 (Frontend Integration) COMPLETED ✅
- Phase 4A (API Route Migration) COMPLETED ✅ (PRs #202, #203)
  - Checkout routes migrated
  - Admin routes migrated (products/[id], orders, refunds)
  - ~14 @mentorships/db imports removed

**Phase 3: Frontend Integration - COMPLETED** ✅
- [x] Installed `@convex-dev/react-query` package
- [x] Created Convex hooks layer at `/apps/web/lib/queries/convex/`:
  - `use-products.ts` - Active products, product by ID
  - `use-sessions.ts` - Student/mentor sessions, upcoming sessions
  - `use-session-packs.ts` - User session packs, active packs
  - `use-users.ts` - Current user, user by ID/email
  - `use-instructors.ts` - Instructor profiles, testimonials
  - `use-mutations.ts` - All CRUD mutations with auto-invalidation
- [x] Migrated 3 key components to Convex:
  - `checkout/page.tsx` - Products now use Convex query
  - `book-session-form.tsx` - Session booking uses Convex mutation (availability still external)
  - `timezone-selector.tsx` - User settings use Convex
- [x] Hybrid approach maintained: TanStack Query kept for external APIs (Google Calendar, Stripe, PayPal)
- [x] TypeScript typecheck passes (0 errors)

**Phase 3: Frontend Integration (continued)**
- [x] Created Convex schema in `convex/schema.ts` with 16 tables:
  - users, mentors, sessions, seatReservations, sessionPacks, orders, payments, products
  - instructors, instructorTestimonials, menteeResults
  - workspaces, workspaceNotes, workspaceLinks, workspaceImages, workspaceMessages, workspaceExports, workspaceRetentionNotifications
- [x] Created query/mutation functions in `convex/`:
  - `users.ts` - getUserByEmail, getCurrentUser, createUser, updateUser
  - `mentors.ts` - getMentorByUserId, listMentors, createMentor, updateMentor, decrement/incrementInventory
  - `sessions.ts` - getStudentSessions, getMentorSessions, getUpcomingSessions, createSession, completeSession, cancelSession
  - `seatReservations.ts` - getUserSeatReservations, getMentorActiveSeats, createSeatReservation, releaseSeat, processExpiredSeats
  - `sessionPacks.ts` - getUserSessionPacks, getUserActiveSessionPacks, createSessionPack, useSession, processExpiredSessionPacks
  - `orders.ts` / `payments.ts` - CRUD operations
  - `products.ts` - getMentorProducts, getActiveProducts, getProductByStripePriceId
  - `instructors.ts` - full CRUD + testimonials, menteeResults
  - `workspaces.ts` - full CRUD for all workspace tables
- [x] Schema compiles successfully with Convex

**What Moves to Convex**:
- Database (all tables: users, mentors, sessions, etc.)
- API Routes (Phase 4A: checkout + admin routes migrated; ~111 imports remain)
- File Storage (images ≤1MB free, ≤5MB Pro)
- Workspace features (notes, links, images, messages)

**What Stays**:
- Auth: Clerk (unchanged)
- Email: Resend (unchanged)
- Payments: Stripe + PayPal (unchanged)
- Background Jobs: Trigger.dev (unchanged)
- Security: Upstash/Redis rate limiting (unchanged)
- Video Storage: Backblaze B2 + Cloudflare (unchanged)
- Video Calls: TBD (Agora or Amazon Chime) - not yet implemented

**Technical Notes**:
- Max file size: 1MB (Free) / 5MB (Pro) - video recordings still go to B2
- Real-time: Automatic reactivity for all queries
- Auth: Convex configured with Clerk JWT issuer

**Estimated Timeline**: ~3-4 weeks (21 days)

**Phase 4A: API Route Migration - COMPLETED** ✅
- [x] Migrated checkout routes (stripe, paypal, verify, cancel, success, capture)
- [x] Migrated products route (by-stripe-price)
- [x] Migrated session-packs routes (list, my)
- [x] Migrated admin routes (products/[id], orders, refunds)
- [x] Created `lib/errors.ts` with UnauthorizedError/ForbiddenError classes
- [x] Created `lib/convex.ts` for shared getConvexClient
- [x] Added Convex functions: getProductForAdmin, getOrdersForAdmin, adminProcessRefund
- [x] Fixed P1 security: added requireAuth to checkout/cancel
- [x] Fixed P2: added order existence verification in checkout/success
- [x] Fixed CodeRabbit issue: replaced redirect() with NextResponse.redirect()

**What moved to Convex (Phase 4A)**:
- Checkout API routes → Convex queries/mutations
- Admin product/order/refund routes → Convex queries/mutations
- External services (Stripe, PayPal) remain in routes

**What stays in routes (Phase 4A)**:
- Stripe/PayPal API calls (webhooks, refunds)
- create-from-stripe (complex Stripe integration)

**Remaining API routes to migrate (~111 imports)**:
- Admin routes: instructors, mentees, workspaces, audit-logs, etc.
- Instructor routes: testimonials, mentees-results, sessions, etc.
- Public routes: availability, booking, etc.
- Webhook handlers (will need separate strategy)

---

### 13. Mentorship Workspace UI (Chat + Notes + Images)
**Status**: ✅ **COMPLETED** - Workspace UI with real-time chat, TipTap rich text notes, and image gallery

**P1 Bug Fixes Applied** (April 18, 2026):
- [x] Added Authorization header verification to all HTTP endpoints in `convex/http.ts`
- [x] Fixed mentee image filter: now shows mentor's images instead of other mentees' images
- [x] Fixed `processExpiredSeats` to set `endedAt` on workspace when seat auto-expires
- [x] Fixed soft-delete of images to decrement workspace counter (frees quota on delete)
- [x] Changed notification day checks from exact equality to ±1 window for robustness
- [x] Removed duplicate `WORKSPACE_IMAGE_CAPS` constant from seatReservations.ts

**Completed Tasks**:
- [x] Created `/workspace` page at `apps/web/app/workspace/page.tsx`:
  - Sidebar with workspace list (grouped by mentor)
  - Tab navigation: Chat | Notes | Images
  - Empty states for no workspaces/content
- [x] Created workspace query hooks at `apps/web/lib/queries/convex/use-workspaces.ts`:
  - Queries: useWorkspace, useWorkspaceNotes, useWorkspaceImages, useWorkspaceMessages, useWorkspaceRole
  - Mutations: useCreateWorkspace*, useUpdateWorkspace*, useDeleteWorkspace*
- [x] Created Chat component (`apps/web/components/workspace/chat.tsx`):
  - Real-time message display with user identification
  - Text input + send
  - **Drag-and-drop image upload** using react-dropzone
  - Image preview before sending
  - Visual feedback on drag hover
  - Exportable for video call overlay (Sheet component ready)
- [x] Created Notes component (`apps/web/components/workspace/notes.tsx`):
  - TipTap rich text editor with StarterKit + Placeholder
  - Notes list with create/edit/delete
  - Auto-save on content change (debounced 1s)
  - Title editing
  - Timestamps
- [x] Created Images component (`apps/web/components/workspace/images.tsx`):
  - Grid gallery with lightbox modal
  - Image upload with cap enforcement (75 mentee / 150 mentor)
  - Remaining count display
  - Delete capability (own images only)
  - Drag-and-drop upload support
- [x] Added TipTap dependencies: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`
- [x] Added workspace navigation to protected layout:
  - "Workspace" link in sidebar navigation
  - Icon: MessageSquare

**Files Created/Modified**:
- `apps/web/app/workspace/page.tsx` - Main workspace page (NEW)
- `apps/web/lib/queries/convex/use-workspaces.ts` - Query/mutation hooks (NEW)
- `apps/web/lib/queries/convex/index.ts` - Export hooks (MODIFIED)
- `apps/web/components/workspace/chat.tsx` - Chat component (NEW)
- `apps/web/components/workspace/notes.tsx` - Notes component (NEW)
- `apps/web/components/workspace/images.tsx` - Images component (NEW)
- `apps/web/components/navigation/protected-layout.tsx` - Added workspace nav (MODIFIED)
- `package.json` - Added TipTap dependencies (MODIFIED)

**Features Implemented**:
- ✅ Chat with real-time updates
- ✅ Drag-and-drop image upload in chat
- ✅ Rich text notes with TipTap editor
- ✅ Notes auto-save
- ✅ Image gallery with caps
- ✅ Image caps enforced (75 mentee / 150 mentor)
- ✅ Lightbox for image viewing
- ✅ Navigation link in sidebar

**Implemented (April 2026)**:
- ✅ In-app retention warning banner (shows at 90/30/7 days before deletion)
- Video call integration with chat sidebar - NOT STARTED

**Reference**: This implementation builds on the Convex workspace backend (`convex/workspaces.ts`) which includes:
- Auto-create workspace on seat reservation
- Workspace auto-deletion timer (18 months after seat release)
- Image caps enforcement
- Role-based filtering

---

### 12. Mentor → Instructor Terminology Migration (Frontend)
**Status**: ✅ **COMPLETED** - User-facing strings migrated from "mentor" to "instructor"

**Completed Tasks**:
- [x] Admin UI labels updated:
  - [x] "Select a mentor" → "Select an instructor"
  - [x] "No mentor record linked" → "No instructor record linked"
  - [x] "Create mentor record" → "Create instructor record"
  - [x] "Manage mentor inventory" → "Manage instructor inventory"
  - [x] "No mentors found" → "No instructors found"
- [x] Booking flow messages updated:
  - [x] "This mentor hasn't connected Google Calendar" → "This instructor hasn't connected Google Calendar"
  - [x] "mentor's Google Calendar" → "instructor's Google Calendar"
- [x] API route renamed:
  - [x] `/api/admin/instructors/[id]/create-mentor` → `/api/admin/instructors/[id]/create-instructor-booking`
- [x] Error messages updated in API routes
- [x] Route build artifacts cleaned and rebuilt

**Note**: Internal database fields (`mentors` table, `mentorId`), variable names, query keys, and API endpoints remain unchanged as they are backend/internal concerns. Only user-facing frontend strings were updated for consistency.

---

### 14. Admin Workspace Access (Dual Workspaces + Audit Logging)
**Status**: ✅ **COMPLETED** - Admin access to all workspaces with private admin communication channels

**Completed Tasks**:
- [x] **Dual Workspace System**:
  - [x] Separate admin-mentee workspaces for private admin↔mentee communication
  - [x] Separate admin-instructor workspaces for private admin↔instructor communication
  - [x] Admin access to all mentorship workspaces (Option B - visible to all parties)
- [x] **Audit Logging**:
  - [x] New `workspaceAuditLogs` table in Convex schema
  - [x] Track: view_workspace, send_message, create_workspace actions
  - [x] Admin audit log viewer at `/admin/audit-logs`
- [x] **Schema Changes**:
  - [x] Added `type` field to workspaces: `mentorship`, `admin_mentee`, `admin_instructor`
  - [x] Added `senderRole` to messages: `mentor`, `mentee`, `admin`
  - [x] Added `userId` field to users table for efficient admin lookups
- [x] **Backend**:
  - [x] Admin role detection in `getWorkspaceRole` function
  - [x] New `convex/adminWorkspaces.ts` with admin-specific queries/mutations
  - [x] Audit logging helper function
- [x] **Frontend**:
  - [x] Admin workspace dashboard at `/admin/workspaces`
  - [x] Workspace detail view with messages and audit log at `/admin/workspaces/[id]`
  - [x] Create admin workspaces at `/admin/workspaces/create`
  - [x] Audit log viewer at `/admin/audit-logs`
- [x] **API Routes**:
  - [x] `GET /api/admin/workspaces` - List all workspaces with filtering
  - [x] `GET /api/admin/workspaces/[id]` - Workspace details + messages + audit logs
  - [x] `POST /api/admin/workspaces/[id]/messages` - Send message as admin
  - [x] `POST /api/admin/workspaces/admin-mentee` - Create admin-mentee workspace
  - [x] `POST /api/admin/workspaces/admin-instructor` - Create admin-instructor workspace
  - [x] `GET /api/admin/audit-logs` - List all audit logs

**Files Created/Modified**:
- `convex/schema.ts` - Added workspace type, senderRole, audit logs, userId
- `convex/workspaces.ts` - Admin role support, audit logging
- `convex/adminWorkspaces.ts` - New admin-specific queries/mutations (NEW)
- `convex/users.ts` - Added getUserByUserId with admin role check
- `apps/web/app/api/admin/workspaces/route.ts` - List workspaces (NEW)
- `apps/web/app/api/admin/workspaces/[id]/route.ts` - Workspace details (NEW)
- `apps/web/app/api/admin/workspaces/[id]/messages/route.ts` - Send message (NEW)
- `apps/web/app/api/admin/workspaces/admin-mentee/route.ts` - Create workspace (NEW)
- `apps/web/app/api/admin/workspaces/admin-instructor/route.ts` - Create workspace (NEW)
- `apps/web/app/api/admin/audit-logs/route.ts` - List audit logs (NEW)
- `apps/web/app/admin/workspaces/page.tsx` - Workspace dashboard (NEW)
- `apps/web/app/admin/workspaces/[id]/page.tsx` - Workspace detail (NEW)
- `apps/web/app/admin/workspaces/create/page.tsx` - Create workspace (NEW)
- `apps/web/app/admin/audit-logs/page.tsx` - Audit log viewer (NEW)

**Reference**: PR #173 - `feat: add admin workspace access with dual workspaces and audit logging`

---

## 🚧 In Progress / Next Steps

### Phase 2: Data Parity (Convex Data Migration)
**Status**: ✅ **COMPLETED** - Instructor data populated into Convex tables

**Goal**: Populate empty Convex tables so instructor detail pages work on dev

**Completed Tasks**:
- [x] Convex schema created with 16 tables (Phase 1-2 of migration)
- [x] Convex query/mutation functions created (Phase 3 of migration)
- [x] Homepage works with static mock data
- [x] Instructor detail pages query Convex (tables now populated)
- [x] Seed mutation `seedInstructorProfiles` created and run
- [x] `instructorProfiles` table populated with 11 instructors
- [x] Testimonials and mentee results also seeded

**Completed Tasks** (April 30, 2026):
- [x] Create instructor records in `instructors` table (with `mentorId` linked to `instructorProfiles`)
- [x] Seed products for each instructor (inventory set, oneOnOne=3, group=2 where applicable)
- [x] Set inventory counts on instructor records
- [x] Link `instructorProfiles.mentorId` to actual `instructors._id` strings

**Executed** (April 30, 2026):
- `seedInstructorsWithProducts` - Created 10 instructor records with products (oneOnOne inventory=3, group inventory=2 where applicable)
- `backfillInstructorProfileMentorIds` - Linked `instructorProfiles.mentorId` to actual `instructors._id` strings for all 10 profiles

**Remaining Task**:
- [ ] Add Stripe/PayPal product IDs to products via `/admin/products/create`

**Reference**: Source data in `apps/web/lib/instructors.ts` (static mock), marketing data in `apps/marketing/data/`

---

### Phase 5: Convex as Single Source of Truth Migration
**Status**: 🚧 **IN PROGRESS** - Migration infrastructure built, awaiting execution

**Goal**: Convex becomes the single source of truth for all application data. Drizzle becomes a read-only reporting replica synced via Inngest events.

**Architecture Decision (May 8, 2026)**:
- Convex = Source of truth, real-time queries, mutations, app data
- Drizzle = Read-only replica for complex aggregation/admin queries
- Sync = Event-driven via Inngest after each Convex mutation

**New Migration Approach (May 9, 2026)**:
Instead of 16 separate scripts with fragile CLI invocations, we now use:
1. **Preprocessor** (`scripts/migrate-to-convex/preprocessor.ts`) - Exports Drizzle tables to JSONL with FK resolution
2. **Import Tool** (`npx convex import`) - Native Convex import for each table
3. **Orchestrator** (`scripts/migrate-to-convex/migrate-all.ts`) - Runs full migration in order

**Migration Execution (May 9, 2026)** ✅ COMPLETED:
- [x] Created `scripts/migrate-to-convex/export-from-supabase.js` using Supabase REST API
- [x] Exported all tables to JSONL files in `migration-data/`:
  - users (11), instructors (16), orders (5), payments (2), sessionPacks (2)
  - seatReservations (1), discordActionQueue (3), waitlist (7), adminDigestSettings (1)
- [x] Imported data to Convex via `npx convex import --table <table> --jsonl migration-data/<table>.jsonl`
- [x] Created mentor-instructor link via `migration-data/mentor-instructor.jsonl`
- [x] Created `convex/migrateIds.ts` with `resolveAllLegacyIds` mutation
- [x] Created `convex/migrationQueries.ts` with internal queries for data access
- [x] Ran `migrateIds:resolveAllLegacyIds` mutation - resolved:
  - 2 payments (orderId → Convex document ID)
  - 2 sessionPacks (mentorId, paymentId → Convex document IDs)
  - 1 seatReservation (mentorId, sessionPackId → Convex document IDs)
- [x] Restored `convex/schema.ts` to use `v.id()` for all resolved fields (payments.orderId, sessionPacks.mentorId/paymentId, seatReservations.mentorId/sessionPackId)

**Supabase REST API Export Method**:
- Used Supabase REST API instead of direct Postgres connection (WSL network issues)
- API Key: stored in environment as `sb_secret_*` (masked)
- Tables exported via `POST /rest/v1/rpc/exec_sql` with Drizzle SQL queries
- Instructor data exported with FK resolution (userId, instructorId lookups)

**Migration Files Created**:
- `convex/schema.ts` - Added `legacyId: v.optional(v.string())` to all tables
- `convex/legacyMappings.ts` - Query helpers to find records by legacyId
- `scripts/migrate-to-convex/preprocessor.ts` - Node.js script using direct postgres connection
- `scripts/migrate-to-convex/migrate-all.ts` - Orchestrator for full migration

**Migration Order** (respects FK dependencies):
```
01 users         (no FK dependencies)
02 instructors   (FK: userId → users)
03 products      (no FK)
04 orders        (FK: userId → users)
05 payments      (FK: orderId → orders)
06 sessionPacks  (FK: userId, mentorId, paymentId)
07 sessions      (FK: mentorId, sessionPackId)
08 seatReservations (FK: orderId, mentorId, sessionPackId)
09 contacts      (no FK)
10 menteeInvitations (FK: instructorId → instructors)
11 menteeSessionCounts (FK: instructorId → instructors)
12 userIdentities (no FK)
13 discordActionQueue (no FK)
14 videoEditorAssignments (no FK)
15 instructorUploads (FK: instructorId → instructors)
16 monthlyStorageCosts (no FK)
```

**Inngest Function Audit**:
| Function | Current Store | Status |
|----------|--------------|--------|
| `payments.ts` | Convex (writes) | ✅ Already using Convex |
| `sessions.ts` | Drizzle | ❌ Needs migration |
| `onboarding.ts` | Drizzle | ❌ Needs migration |
| `clerk-user-linking.ts` | Drizzle | ❌ Needs migration |
| `discord.ts` | Drizzle | ❌ Needs migration |
| `clerk-user-deleted.ts` | Drizzle | ❌ Needs migration |
| `notifications.ts` | Drizzle | ❌ Needs migration |
| `booking-emails.ts` | Drizzle | ❌ Needs migration |

**Migration Phases**:

**Phase 1: Schema & Infrastructure** ✅ COMPLETE
- [x] Add `legacyId` field to all Convex tables
- [x] Add `clerkId` as required field on users table
- [x] Make `userId` required on instructors table
- [x] Create `legacyMappings.ts` query helpers
- [x] Create `preprocessor.ts` for Drizzle export + FK resolution
- [x] Create `migrate-all.ts` orchestrator

**Phase 2: Run Migration** ✅ COMPLETED (May 9, 2026)
- [x] Exported all data from Supabase to JSONL files via REST API
- [x] Imported all tables to Convex (users, instructors, orders, payments, sessionPacks, seatReservations, discordActionQueue, waitlist)
- [x] Resolved all legacy UUID string IDs to proper Convex document IDs
- [x] Verified data integrity with migration queries

**Phase 3: Inngest Function Migration (1-2 weeks)**
- [ ] Migrate `sessions.ts` to Convex
- [ ] Migrate `onboarding.ts` to Convex
- [ ] Migrate `clerk-user-linking.ts` to Convex
- [ ] Migrate `clerk-user-deleted.ts` to Convex
- [ ] Migrate `discord.ts` to Convex
- [ ] Migrate `notifications.ts` to Convex
- [ ] Migrate `booking-emails.ts` to Convex

**Phase 4: Event-Driven Sync (3-5 days)**
- [ ] Create Inngest sync handlers for Drizzle replica
- [ ] Event flow: Convex Mutation → `inngest.send()` → Inngest handler → Drizzle

**Phase 5: Cleanup (2-3 days)**
- [ ] Deprecate Drizzle mutation functions
- [ ] Document architecture in `ARCHITECTURE.md`

---

## 🔧 Detailed Implementation Plan (Phase 3-5)

### Architecture Decisions (May 2026)

**What Stays in Inngest (Reliability)**:
- External webhooks (Stripe, PayPal, Clerk) - Inngest handles signature verification, retries, and observability
- Email sending functions - Inngest provides reliable delivery with retries
- Notification routing - Inngest's step functions handle fan-out to multiple channels
- Scheduled cron jobs for background cleanup - Inngest handles distributed scheduling

**What Moves to Convex (Internal Logic)**:
- Session state transitions (completion, cancellation)
- Clerk user linking/unlinking (internal business logic)
- Seat reservation expiration checks (data-driven cron)
- Discord queue processing (background worker)
- Onboarding workflow orchestration (multi-step with external calls)

**Sync Architecture**:
```
External Webhooks (Stripe/PayPal/Clerk)
    │
    ▼
Inngest (reliable ingestion + signature verification)
    │
    ├──► Convex (source of truth - all writes)
    │
    ├──► Convex triggers Inngest events (data.sync.*)
    │
    └──► Inngest sync handler → Drizzle replica (30-60s delay acceptable)
```

---

### Phase 3A: Simple Function Migrations (Week 1, Days 1-3)

**Pattern**: Convert Inngest functions to Convex `internalAction` for event-driven logic, Convex `schedules.task()` for cron jobs.

#### 3A-1: `clerk-user-deleted.ts` → Convex internalAction

**Current Inngest function** (`inngest/functions/clerk-user-deleted.ts`):
- Triggered by `clerk/user.deleted` event
- Sets `instructors.userId = null` when Clerk user is deleted
- Simple single-table update

**Convex replacement** (`convex/instructors.ts`):
```typescript
// Using Convex internalAction pattern from context7 docs
export const unlinkClerkUserFromInstructor = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const instructor = await ctx.runQuery(
      internal.instructors.getByUserId,
      { userId: args.userId }
    );
    if (instructor) {
      await ctx.runMutation(
        internal.instructors.update,
        { id: instructor._id, userId: undefined }
      );
    }
  },
});
```

**Files to modify**:
- `convex/instructors.ts` - Add `unlinkClerkUserFromInstructor` internalAction
- `inngest/functions/clerk-user-deleted.ts` - Deprecate (remove after verification)

**Trigger**: Keep Inngest webhook receiving `clerk/user.deleted`, but have it call Convex internalAction instead of Drizzle query.

**Estimated time**: 2 hours

---

#### 3A-2: `notifications.ts` → Convex internalAction

**Current**: `handleNotificationSend` routes to email/Discord based on user preferences.

**Convex replacement**: Create `convex/notifications.ts` with internalAction that handles notification dispatch.

**Pattern from context7** (Convex action for external API calls):
```typescript
export const sendNotification = internalAction({
  args: {
    userId: v.string(),
    type: v.union(v.literal("email"), v.literal("discord")),
    content: v.object({
      subject: v.optional(v.string()),
      body: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.getById, { id: args.userId });
    
    if (args.type === "email" && user?.email) {
      await sendEmailAction({ to: user.email, ...args.content });
    }
    
    if (args.type === "discord") {
      const identity = await ctx.runQuery(
        internal.userIdentities.getByUserIdAndProvider,
        { userId: args.userId, provider: "discord" }
      );
      if (identity?.providerUserId) {
        await sendDiscordDmAction({ discordId: identity.providerUserId, ...args.content });
      }
    }
  },
});
```

**Files to create/modify**:
- `convex/notifications.ts` - New file with notification actions
- `inngest/functions/notifications.ts` - Update to call Convex action

**Estimated time**: 4 hours

---

#### 3A-3: `handleRenewalReminder` → Convex internalAction

**Current**: Triggered by `session/renewal-reminder` event, sends notification to user.

**Convex replacement**: Create internalAction in `convex/sessions.ts` to handle renewal reminders.

**Files to modify**:
- `convex/sessions.ts` - Add `handleRenewalReminder` internalAction
- Remove Inngest function after verification

**Estimated time**: 2 hours

---

#### 3A-4: `sendGracePeriodFinalWarning` → Convex schedules.task() cron

**Current**: Hourly cron checks `seatReservations` for grace period ending within 12 hours.

**Convex replacement**: Use `schedules.task()` pattern from context7 docs:

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "send-grace-period-warnings",
  { hours: 1 },
  internal.seatReservations.sendGracePeriodWarnings,
);

export default crons;
```

**Files to create/modify**:
- `convex/seatReservations.ts` - Add `sendGracePeriodWarnings` internal mutation
- `convex/crons.ts` - Add new cron interval (or add to existing crons.ts if it exists)

**Estimated time**: 3 hours

---

### Phase 3B: Medium Function Migrations (Week 1, Days 4-5 + Week 2) - ✅ COMPLETE

**Completed May 9, 2026**:
- [x] Added `mentors` table to Convex schema with `userId` index
- [x] Added `by_email` index on `instructors` table
- [x] Created `convex/mentors.ts` with `getMentorByUserId`, `createMentor`, `getOrCreateMentor`
- [x] Created session internalQueries: `getSessionByIdInternal`, `getSessionPackByIdInternal`, `getCompletedSessionCountInternal`
- [x] Created session internalMutations: `decrementRemainingSessions`, `updateSeatReservationStatusInternal`, `updateSessionPackStatusInternal`
- [x] Created `handleSessionCompleted` internalAction (in `convex/sessions.ts`)
- [x] Created seat expiration internalQueries: `listExpiredPacks`, `listExpiredGraceSeats`, `checkScheduledSessionsForPack`
- [x] Created seat internalMutations: `getSeatBySessionPackId`, `releaseSeatById` (in `convex/seatReservations.ts`)
- [x] Created `checkSeatExpiration` internalAction (in `convex/sessions.ts`)
- [x] Created Discord queue internalQueries: `claimDiscordActions`, `getDiscordIdentityForUserId`
- [x] Created Discord queue internalMutations: `markDiscordActionDone`, `markDiscordActionFailed`, `requeueDiscordAction`
- [x] Created `processDiscordActionQueue` internalAction with full Discord API integration (in `convex/discordActionQueue.ts`)
- [x] Created instructor internalQueries: `getInstructorByEmailInternal`, `getPendingMenteeInvitationsByEmail`
- [x] Created instructor internalMutations: `linkInstructorToMentor`, `acceptMenteeInvitation`
- [x] Created `linkClerkUserToInstructor` internalAction (in `convex/instructors.ts`)
- [x] Added Cron jobs: `check-seat-expiration` (hourly), `process-discord-action-queue` (every minute) to `convex/crons.ts`
- [x] Created Clerk webhook endpoint: `POST /webhooks/clerk` for user.created/user.deleted events (in `convex/http.ts`)

**Files Modified**:
- `convex/schema.ts` - Added `mentors` table, `by_email` index on instructors
- `convex/mentors.ts` - New file with mentor internalQueries/mutations
- `convex/sessions.ts` - Added session internalQueries/mutations/actions
- `convex/seatReservations.ts` - Added seat internalQueries/mutations
- `convex/discordActionQueue.ts` - Added queue processing internalQueries/mutations/actions
- `convex/instructors.ts` - Added linking internalQueries/mutations/actions
- `convex/crons.ts` - Added new cron jobs
- `convex/http.ts` - Added Clerk webhook endpoint

---

### Phase 3B: Medium Function Migrations (Week 1, Days 4-5 + Week 2)

#### 3B-1: `sessions.ts` - `handleSessionCompleted` → Convex internalAction

**Current**: Updates session status, decrements pack remaining sessions, triggers renewal reminders.

**Convex replacement**:
```typescript
export const handleSessionCompleted = internalAction({
  args: {
    sessionId: v.id("sessions"),
    recordingUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Update session status to completed
    await ctx.runMutation(internal.sessions.completeSession, {
      id: args.sessionId,
      recordingUrl: args.recordingUrl,
      notes: args.notes,
    });

    // 2. Get session pack and decrement remaining
    const session = await ctx.runQuery(internal.sessions.getById, { id: args.sessionId });
    if (session) {
      await ctx.runMutation(internal.sessionPacks.useSession, {
        id: session.sessionPackId,
      });

      // 3. Check if renewal reminder needed (session 3 or 4 of pack)
      const completedCount = await ctx.runQuery(
        internal.sessions.getCompletedCountForPack,
        { sessionPackId: session.sessionPackId }
      );
      
      if (completedCount === 3 || completedCount === 4) {
        await ctx.runMutation(internal.notifications.queueRenewalReminder, {
          sessionPackId: session.sessionPackId,
          reminderType: completedCount === 4 ? "final" : "warning",
        });
      }
    }
  },
});
```

**Files to create/modify**:
- `convex/sessions.ts` - Add `handleSessionCompleted` internalAction
- `convex/sessionPacks.ts` - Add `useSession` mutation if not exists
- `inngest/functions/sessions.ts` - Remove `handleSessionCompleted` after verification

**Estimated time**: 5 hours

---

#### 3B-2: `sessions.ts` - `checkSeatExpiration` → Convex scheduled task

**Current**: Hourly cron that releases expired seats.

**Convex replacement**: Use `crons.interval()` pattern:

```typescript
// convex/crons.ts
crons.interval(
  "check-seat-expiration",
  { hours: 1 },
  internal.seatReservations.processExpiredSeats,
);
```

**Files to modify**:
- `convex/seatReservations.ts` - Add `processExpiredSeats` internal mutation
- `convex/crons.ts` - Add interval (or confirm existing)

**Estimated time**: 4 hours

---

#### 3B-3: `discord.ts` - `processDiscordActionQueue` → Convex scheduled task

**Current**: Every-minute cron processes `discordActionQueue` for role assignments and DMs.

**Convex replacement**: Use `crons.interval()` with batch processing:

```typescript
// convex/crons.ts
crons.interval(
  "process-discord-actions",
  { minutes: 1 },
  internal.discordActionQueue.processPending,
);

// convex/discordActionQueue.ts
export const processPending = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const actions = await ctx.runQuery(
      internal.discordActionQueue.claimStaleActions,
      { limit: 25 }
    );
    
    for (const action of actions) {
      try {
        if (action.type === "assign_mentee_role") {
          await ctx.runAction(internal.discord.assignRole, {
            userId: action.subjectUserId,
            roleName: action.metadata?.roleName,
          });
        } else if (action.type === "dm_instructor_new_signup") {
          await ctx.runAction(internal.discord.sendDm, {
            userId: action.subjectUserId,
            message: action.metadata?.message,
          });
        }
        await ctx.runMutation(internal.discordActionQueue.markDone, { id: action._id });
      } catch (error) {
        await ctx.runMutation(internal.discordActionQueue.handleError, {
          id: action._id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  },
});
```

**Files to create/modify**:
- `convex/discordActionQueue.ts` - Add `processPending`, `claimStaleActions`, `markDone`, `handleError`
- `convex/discord.ts` - Add `assignRole`, `sendDm` internalActions for Discord API calls
- `convex/crons.ts` - Add interval

**Estimated time**: 5 hours

---

#### 3B-4: `clerk-user-linking.ts` → Convex internalAction with transaction

**Current**: Links Clerk user to instructor, creates mentor record if needed.

**Convex replacement**:
```typescript
export const linkClerkUserToInstructor = internalAction({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Find instructor by email (case-insensitive)
    const instructor = await ctx.runQuery(
      internal.instructors.getByEmail,
      { email: args.email.toLowerCase() }
    );
    
    if (!instructor) return { success: false, reason: "instructor_not_found" };
    
    // 2. Check if mentor exists for this user, create if not
    const existingMentor = await ctx.runQuery(
      internal.mentors.getByUserId,
      { userId: args.clerkUserId }
    );
    
    let mentorId = existingMentor?._id;
    if (!mentorId) {
      mentorId = await ctx.runMutation(internal.mentors.create, {
        userId: args.clerkUserId,
      });
    }
    
    // 3. Update instructor with userId and mentorId
    await ctx.runMutation(internal.instructors.linkUserAndMentor, {
      id: instructor._id,
      userId: args.clerkUserId,
      mentorId,
    });
    
    // 4. Handle any pending mentee invitations
    const pendingInvitations = await ctx.runQuery(
      internal.menteeInvitations.getPendingByEmail,
      { email: args.email }
    );
    
    for (const invitation of pendingInvitations) {
      await ctx.runMutation(internal.menteeInvitations.accept, {
        id: invitation._id,
        userId: args.clerkUserId,
      });
    }
    
    return { success: true };
  },
});
```

**Files to create/modify**:
- `convex/instructors.ts` - Add `linkUserAndMentor` mutation, `getByEmail` query
- `convex/mentors.ts` - Add `getByUserId` query (verify exists)
- `convex/menteeInvitations.ts` - Add `getPendingByEmail`, `accept` mutation
- `inngest/functions/clerk-user-linking.ts` - Deprecate

**Estimated time**: 4 hours

---

#### 3B-5: `booking-emails.ts` - 4 functions → Convex

| Function | Convex Pattern | Effort |
|----------|---------------|--------|
| `handleSessionBookingEmails` | `internalAction` triggered by `session/booked` | 4hr |
| `handleSessionReminderEmails` | `schedules.task()` with `wait.for()` delay | 4hr |
| `handleSessionCancellationEmails` | `internalAction` triggered by `session/canceled` | 3hr |
| `scheduleSessionReminders` | Use Convex `wait.for()` in action instead of Inngest sleep | 4hr |

**Scheduling Pattern** (from context7 docs):
```typescript
// Instead of Inngest step.sleep(), use Convex scheduler
await ctx.runAction(internal.notifications.scheduleReminder, {
  sessionId: args.sessionId,
  type: "24h",
  runAt: scheduledAt - 24 * 60 * 60 * 1000,
});

// Or use step.runAction with runAfter for delayed execution
const result = await step.runAction(
  internal.notifications.sendReminder,
  { sessionId },
  { runAfter: 24 * 60 * 60 * 1000 }
);
```

**Files to create/modify**:
- `convex/bookingEmails.ts` - New file with all 4 functions
- `convex/notifications.ts` - Add scheduling helpers
- `inngest/functions/booking-emails.ts` - Deprecate after verification

**Estimated time**: 2 days

---

### Phase 3C: Complex Function Migration (Week 2, Days 3-5)

#### 3C-1: `onboarding.ts` → Convex Workflow using `@convex-dev/workflow`

**Why `@convex-dev/workflow`**: Multi-step workflow with external API calls (Clerk, email, Discord), each step can fail and needs retry without redoing successful steps.

**Current flow**:
1. Validate purchase event
2. Create Discord identity record
3. Send onboarding email to student
4. Send instructor notification email
5. Send admin notification email
6. Queue Discord actions

**Convex Workflow pattern** (from context7 docs):
```typescript
import { v } from "convex/values";
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";

const workflow = new WorkflowManager(components.workflow);

export const onboardingWorkflow = workflow.define({
  args: {
    orderId: v.id("orders"),
    userId: v.string(),
    mentorId: v.id("instructors"),
    sessionPackId: v.id("sessionPacks"),
  },
  returns: v.object({
    success: v.boolean(),
    stepsCompleted: v.array(v.string()),
  }),
  handler: async (step, args): Promise<{ success: boolean; stepsCompleted: string[] }> => {
    const completedSteps: string[] = [];

    // Step 1: Validate purchase
    const order = await step.runQuery(
      internal.orders.getOrder,
      { orderId: args.orderId },
      { inline: true }
    );
    
    if (!order) {
      return { success: false, stepsCompleted: [] };
    }

    // Step 2: Create Discord identity (with retry for external API)
    const discordIdentity = await step.runAction(
      internal.discord.getIdentity,
      { userId: args.userId },
      { retry: { maxAttempts: 3, initialBackoffMs: 500, base: 2 } }
    );
    
    if (discordIdentity?.discordUserId) {
      await step.runMutation(
        internal.userIdentities.create,
        {
          userId: args.userId,
          provider: "discord",
          providerUserId: discordIdentity.discordUserId,
        }
      );
      completedSteps.push("discord_identity");
    }

    // Step 3: Send onboarding email to student (with retry)
    await step.runAction(
      internal.email.sendOnboardingStudent,
      {
        userId: args.userId,
        mentorId: args.mentorId,
        sessionPackId: args.sessionPackId,
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 1000, base: 2 } }
    );
    completedSteps.push("student_email");

    // Step 4: Send instructor notification email
    await step.runAction(
      internal.email.sendOnboardingInstructor,
      {
        userId: args.userId,
        mentorId: args.mentorId,
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 1000, base: 2 } }
    );
    completedSteps.push("instructor_email");

    // Step 5: Send admin notification email
    await step.runAction(
      internal.email.sendOnboardingAdmin,
      { orderId: args.orderId },
      { retry: true }
    );
    completedSteps.push("admin_email");

    // Step 6: Queue Discord actions
    await step.runMutation(
      internal.discordActionQueue.createActions,
      {
        mentorId: args.mentorId,
        userId: args.userId,
        actions: [
          { type: "assign_mentee_role", subjectUserId: args.userId },
          { type: "dm_instructor_new_signup", subjectUserId: args.userId },
        ],
      }
    );
    completedSteps.push("discord_queue");

    return { success: true, stepsCompleted: completedSteps };
  },
  workpoolOptions: {
    retryActionsByDefault: true,
  },
});
```

**Files to create/modify**:
- `convex/workflows/onboarding.ts` - New file with workflow
- `convex/workflows/index.ts` - Export workflows
- `convex/http.ts` - Register webhook endpoint to trigger workflow
- `inngest/functions/onboarding.ts` - Deprecate after verification

**Estimated time**: 2 days

---

### Phase 3D: API Route Migrations (Week 3)

#### Critical Write Migrations

| Route | Current | Target | Priority |
|-------|---------|--------|----------|
| `api/onboarding/submit/route.ts` | Drizzle writes to `menteeOnboardingSubmissions` + `discordActionQueue` | Convex mutation | High |
| `api/sessions/route.ts` (POST) | Drizzle writes to `sessions` + Google Calendar | Hybrid: Google Calendar in route, Convex mutation for session creation | High |
| `api/instructor/onboarding/review/route.ts` | Drizzle write | Convex mutation | Medium |

**Google Calendar Integration Decision (Hybrid Approach)**:
- Keep Google Calendar API calls in API route (requires OAuth refresh token decryption)
- Call Convex mutation to create session record after calendar event succeeds
- This maintains reliability: if calendar succeeds but Convex fails, route handles cleanup

```typescript
// api/sessions/route.ts (conceptual hybrid approach)
export async function POST(req: NextRequest) {
  // ... validation, eligibility check, Google Calendar call ...
  
  const calendarEventId = await calendar.events.insert({ ... });
  
  // Now call Convex mutation instead of Drizzle insert
  const session = await convexMutation("sessions.create", {
    mentorId,
    studentId: user.id,
    sessionPackId,
    scheduledAt: start.getTime(),
    googleCalendarEventId: calendarEventId,
  });
  
  // Trigger Inngest for emails (kept in Inngest for reliability)
  await inngest.send({
    name: "session/booked",
    data: { sessionId: session._id, ... }
  });
  
  return NextResponse.json({ session });
}
```

**Files to modify**:
- `apps/web/app/api/sessions/route.ts` - Replace Drizzle insert with Convex mutation call
- `apps/web/app/api/onboarding/submit/route.ts` - Replace Drizzle with Convex mutation
- `apps/web/app/api/instructor/onboarding/review/route.ts` - Replace Drizzle with Convex mutation

**Estimated time**: 3 days

---

### Phase 4: Event-Driven Sync (Week 4, Days 1-5)

**Architecture**: Convex triggers Inngest → Drizzle replica

**Sync Events** (30-60 second eventual consistency is acceptable):
- `data.sessions.changed` - Session created/updated/canceled
- `data.sessionPacks.changed` - Pack created/updated
- `data.seatReservations.changed` - Seat reserved/released
- `data.orders.changed` - Order created/updated
- `data.payments.changed` - Payment created/updated

**Implementation Pattern**:

1. **Create Convex internal mutation to send sync events**:
```typescript
// convex/sync.ts
export const notifyDataChange = internalAction({
  args: {
    table: v.string(),
    operation: v.union(v.literal("insert"), v.literal("update"), v.literal("delete")),
    id: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Use step.runAction with retry for reliable delivery
    await ctx.runAction(internal.inngest.sendEvent, {
      event: {
        name: `data.${args.table}.${args.operation}`,
        data: {
          id: args.id,
          operation: args.operation,
          data: args.data,
          timestamp: Date.now(),
        },
      },
    });
  },
});
```

2. **Wrap existing Convex mutations to call sync**:
```typescript
// In each mutation that needs sync, add at the end:
await ctx.runMutation(internal.sync.notifyDataChange, {
  table: "sessions",
  operation: "insert",
  id: result._id.toString(),
  data: result,
});
```

3. **Create Inngest sync handlers**:
```typescript
// inngest/functions/sync-to-drizzle.ts
export const syncSessionsToDrizzle = inngest.createFunction(
  {
    id: "sync-sessions-to-drizzle",
    retries: { maxAttempts: 5 },
  },
  { event: "data.sessions.*" },
  async ({ event, step }) => {
    await step.run("sync-to-drizzle", async () => {
      const { operation, data } = event.data;
      
      if (operation === "insert") {
        await db.insert(sessions).values({
          id: data.id,
          mentorId: data.mentorId,
          studentId: data.studentId,
          // ... map all fields
        });
      } else if (operation === "update") {
        await db.update(sessions).set(data).where(eq(sessions.id, data.id));
      }
      // Handle delete similarly
    });
  }
);
```

**Files to create**:
- `convex/sync.ts` - Internal actions for sync events
- `inngest/functions/sync-to-drizzle.ts` - Sync handlers (one per table group)
- `convex/crons.ts` - Register sync event sending if needed

**Estimated time**: 4 days

---

### Phase 5: Cleanup (Week 4, Days 6-7 + Week 5)

#### 5-1: Deprecate Drizzle Mutations

Mark deprecated functions and remove from exports:
- `packages/db/src/lib/mutations/sessions.ts` - Mark as deprecated
- `packages/db/src/lib/mutations/onboarding.ts` - Mark as deprecated
- `packages/db/src/lib/mutations/menteeOnboarding.ts` - Mark as deprecated

#### 5-2: Remove Connection Pool Fix

After verifying only reads hit Drizzle, the connection pool sizing in `packages/db/src/lib/drizzle.ts` can be simplified.

#### 5-3: Document Architecture

Create `ARCHITECTURE.md`:
```
# Mentorship Platform Architecture

## Data Flow
- Convex = Source of truth for all app data
- Drizzle = Read-only replica for complex aggregation queries
- Inngest = External webhook handling + reliable email/notification delivery

## Key Decisions (May 2026)
- External webhooks (Stripe, PayPal, Clerk) → Inngest
- Internal business logic → Convex actions/scheduled tasks
- Email/notification delivery → Inngest (reliable retry)
- Complex admin queries → Drizzle (read replica)

## Sync Strategy
- Convex mutations trigger `data.*` events via Inngest
- 30-60 second eventual consistency acceptable
- Idempotency keys prevent duplicate writes
```

**Estimated time**: 2-3 days

---

### File Mapping Summary

| Inngest File | Convex Replacement | Pattern |
|--------------|-------------------|---------|
| `inngest/functions/clerk-user-deleted.ts` | `convex/instructors.ts` (new internalAction) | internalAction |
| `inngest/functions/clerk-user-linking.ts` | `convex/instructors.ts` + `convex/menteeInvitations.ts` | internalAction with transaction |
| `inngest/functions/notifications.ts` | `convex/notifications.ts` | internalAction |
| `inngest/functions/sessions.ts` - `handleSessionCompleted` | `convex/sessions.ts` | internalAction |
| `inngest/functions/sessions.ts` - `checkSeatExpiration` | `convex/seatReservations.ts` + `convex/crons.ts` | schedules.task() |
| `inngest/functions/sessions.ts` - `handleRenewalReminder` | `convex/sessions.ts` | internalAction |
| `inngest/functions/sessions.ts` - `sendGracePeriodFinalWarning` | `convex/seatReservations.ts` + `convex/crons.ts` | schedules.task() |
| `inngest/functions/discord.ts` | `convex/discordActionQueue.ts` + `convex/crons.ts` | schedules.task() |
| `inngest/functions/onboarding.ts` | `convex/workflows/onboarding.ts` | @convex-dev/workflow |
| `inngest/functions/booking-emails.ts` (4 functions) | `convex/bookingEmails.ts` + `convex/notifications.ts` | internalAction + schedules.task() |

**API Routes to modify**:
| Route | Change |
|-------|--------|
| `apps/web/app/api/sessions/route.ts` | Replace Drizzle insert with Convex mutation |
| `apps/web/app/api/onboarding/submit/route.ts` | Replace Drizzle with Convex mutation |
| `apps/web/app/api/instructor/onboarding/review/route.ts` | Replace Drizzle with Convex mutation |

**New Files to Create**:
- `convex/notifications.ts` - Notification actions
- `convex/bookingEmails.ts` - Email scheduling actions
- `convex/workflows/onboarding.ts` - Onboarding workflow
- `convex/sync.ts` - Sync event actions
- `inngest/functions/sync-to-drizzle.ts` - Drizzle replica sync handlers

---

### Timeline Summary

```
Week 1, Days 1-3: Phase 3A (Simple functions)
  - clerk-user-deleted.ts → Convex
  - notifications.ts → Convex
  - handleRenewalReminder → Convex
  - sendGracePeriodFinalWarning → Convex

Week 1, Days 4-5: Phase 3B start (Medium functions)
  - handleSessionCompleted → Convex
  - checkSeatExpiration → Convex scheduled task

Week 2, Days 1-2: Phase 3B finish
  - processDiscordActionQueue → Convex scheduled task
  - clerk-user-linking.ts → Convex

Week 2, Days 3-5: Phase 3C (Complex function)
  - onboarding.ts → Convex Workflow (@convex-dev/workflow)
  - booking-emails.ts (4 functions) → Convex

Week 3: Phase 3D (API Routes)
  - sessions/route.ts → Hybrid (Google Calendar in route + Convex mutation)
  - onboarding/submit/route.ts → Convex mutation

Week 4, Days 1-5: Phase 4 (Event-Driven Sync)
  - Create sync event actions in Convex
  - Create Inngest sync handlers for Drizzle replica

Week 4, Days 6-7 + Week 5: Phase 5 (Cleanup)
  - Deprecate Drizzle mutations
  - Document architecture
  - Verify all routes work
```

**Total: ~5 weeks**

---

### Open Questions / Decisions Made

| Question | Decision |
|----------|----------|
| Use `@convex-dev/workflow` for onboarding? | **Yes** - Multi-step with external calls needs durability |
| Keep Google Calendar in route or move to Convex? | **Hybrid** - Keep in route (OAuth token management), call Convex mutation for session creation |
| What stays in Inngest? | External webhooks, email/notification sending, high-frequency scheduled tasks |
| What moves to Convex? | Internal state transitions, Clerk user linking, seat expiration, Discord queue processing |
| Sync frequency? | 30-60 seconds (acceptable for admin analytics) |
| Testing approach? | Shadow mode first, then gradual cutover per function |

---

### References

- **Convex Workflow**: `@convex-dev/workflow` package with `WorkflowManager` (context7: /get-convex/workflow)
- **Convex Scheduled Tasks**: `cronJobs()` from `convex/server` (context7: /websites/convex_dev)
- **Convex Internal Actions**: `internalAction` for server-side logic with external calls (context7: /get-convex/convex-backend)
- **Inngest Step Functions**: `step.run()`, `step.sendEvent()` for reliable execution (context7: /websites/inngest)
- **Inngest Cron Triggers**: `cron()` helper for scheduling (context7: /websites/inngest)

---

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
**Status**: ❌ **NOT STARTED** - apps/bot directory does not exist

**Tasks**:
- [ ] Create `apps/bot` application
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
**Status**: ✅ **COMPLETED** - Full implementation with real-time chat, TipTap notes, image gallery, and ZIP export

**ZIP Export Implementation** (April 18, 2026):
- [x] Created Trigger.dev task `process-workspace-export` in `src/trigger/workspace-export.ts`
- [x] Fetches workspace notes and images from Convex via HTTP endpoints
- [x] Generates ZIP with `notes.md` and `images/` folder
- [x] Uploads ZIP to Backblaze B2 storage
- [x] Provides 7-day download URL
- [x] UI: "Download All" button in Images tab with progress state
- [x] Exports images + notes (no chat history per spec)
- [x] Added environment variables: `TRIGGER_API_KEY`, `NEXT_PUBLIC_TRIGGER_PROJECT_REF`

**Files Created/Modified**:
- `packages/storage/src/zip.ts` - ZIP creation and B2 upload (NEW)
- `packages/storage/package.json` - Added archiver dependency
- `src/trigger/workspace-export.ts` - Trigger.dev task (NEW)
- `convex/workspaces.ts` - Added `getWorkspaceExportData`, `getWorkspaceExports`, updated `createWorkspaceExport` to trigger task
- `convex/http.ts` - Added HTTP endpoints for export data and status updates
- `apps/web/components/workspace/images.tsx` - Added "Download All" button with progress
- `apps/web/lib/queries/convex/use-workspaces.ts` - Added `useWorkspaceExports` hook
- `trigger.config.ts` - Added external packages: archiver, @aws-sdk/client-s3
- `.env.example` - Added Trigger.dev environment variables
- `package.json` - Added archiver and @aws-sdk/client-s3 as root dependencies

**Goal**: Add a mentorship-wide shared space (per active mentorship) where mentees and instructors can:
- Record notes and share links (both can read; only authors can edit/delete their own entries)
- Upload images:
  - Mentee cap: 75 images per mentorship
  - Mentor cap: 150 images per mentorship
- "Download all images" (mentee downloads a ZIP containing ALL images in the workspace, including instructor uploads)

**Retention policy**:
- Delete ALL workspace content (notes + links + images) **18 months after mentorship ends**
- "Mentorship ends" is defined as when the **seat reservation is released** (`seat_reservations.status = released`)
- Notify mentees ahead of deletion at **90 / 30 / 7 days** (email + in-app banner) with a one-click "Download all" button
- No need to notify instructors about deletion

---

### Priority 9: Video Access Control (Agora)
**Status**: ❌ **NOT STARTED** - apps/video directory does not exist

**Tasks**:
- [ ] Create `apps/video` application
- [ ] Set up Agora account
- [ ] Create token generation service
- [ ] Implement access control:
  - [ ] Check `session.status === "scheduled"`
  - [ ] Check `remaining_sessions > 0`
- [ ] Integrate with video call UI

**Estimated Time**: 1-2 days

---

### Priority 10: Inventory Management (Convex + Admin UI)
**Status**: ✅ **COMPLETED** - All phases complete

**Goal**: Implement inventory counts for instructors in Convex with easy admin management and integration with purchase flow.

**Architecture Decision**: Inventory lives on `mentors` table (already has `oneOnOneInventory` and `groupInventory` fields). Instructors link to mentors via `mentorId`.

**Phase 1: Convex Backend** ✅ COMPLETE
- [x] Add waitlist table to Convex schema (`marketingWaitlist`)
- [x] Add waitlist query/mutation functions in Convex:
  - `getWaitlistForInstructor(slug, type)` - list waitlist entries
  - `addToWaitlist(email, instructorSlug, type)` - join waitlist
  - `getWaitlistStatus(email, instructorSlug)` - check if already on list
  - `markWaitlistNotified(ids)` - mark as notified
  - `removeFromWaitlist(ids)` - remove entries
- [x] Add inventory HTTP endpoints in Convex:
  - `POST /inventory/decrement` - Called after seat reservation
  - `POST /inventory/increment` - Called on refund
  - `POST /inventory/set` - For direct inventory setting
  - `POST /waitlist/notify` - Mark waitlist as notified
- [x] Create frontend hooks: `use-mentors.ts`, `use-waitlist.ts`

**Phase 2: Inngest Integration** ✅ COMPLETE
- [x] Wire up inventory decrement in Inngest payment flow (after seat reservation created)
- [x] Add inventory restore on refund
- [x] Added `mentorshipType` to `sessionPacks` table for refund lookup
- [x] Added environment variables: `CONVEX_URL`, `CONVEX_HTTP_KEY`

**Phase 3: Admin UI** ✅ COMPLETE (April 2026)
- [x] Add inventory fields to instructor create form (new "Inventory" tab)
- [x] Add inventory fields to instructor edit form (new "Inventory" tab)
- [x] Create `/admin/inventory` page:
  - Grid of mentor cards showing current inventory
  - Inline edit with +/- buttons and direct input
  - "Notify Waitlist" button per mentorship type
  - "View Waitlist" modal showing email list
- [x] Uses `useUpdateInstructor` hook for inventory updates (note: `useInstructorInventory` not needed as separate hook)

**UX Design**:
- Create form: Optional checkbox "Create mentor record for bookings" - when checked, creates both instructor AND mentor with default inventory 0
- Edit form: If instructor has linked mentorId, show inventory section - if not, show "Enable bookings" button to create mentor
- Admin inventory page: List all mentors (not just those with instructor profiles)

**Reference**: Similar to apps/marketing `/admin/inventory` implementation

**Estimated Time**: 3-4 days (completed)

---

### Priority 11: Waitlist System (Convex + Resend + Sold-Out UI)
**Status**: ✅ **COMPLETED** - All phases complete

**Goal**: Allow users to join waitlist when instructor inventory is sold out, and notify them when spots become available.

**Waitlist Notification Logic**:
- **Trigger**: When admin updates inventory from 0 → N (via inventory page or instructor edit)
- **Send to**: All waitlisted users for that instructor + mentorship type who haven't been notified yet
- **Email content**: "Spots available!" with CTA, plus "Stop notifications" link that removes them from waitlist
- **Deduplication**: Track `notifiedAt` timestamp, only notify once per availability window
- **Batching**: Notifications batched with 5-minute delay to consolidate rapid changes

**Phase 1: Backend (Convex)** ✅ COMPLETE
- [x] Create waitlist queries/mutations in Convex
- [x] Handle email deduplication (unique per instructor + type)
- [x] Add Resend email template for waitlist notification

**Phase 2: Trigger on Inventory Change** ✅ COMPLETE
- [x] Create Inngest function to trigger waitlist notifications when inventory changes 0→N
- [x] Send emails to all un-notified waitlisted users for that mentorship type
- [x] Mark users as notified after sending

**Phase 3: Frontend - Sold Out Handling** ✅ COMPLETE (April 2026)
- [x] Update apps/web `/instructors/[slug]` to check inventory from Convex
- [x] Show waitlist form when inventory = 0 instead of "Buy" button
- [x] Waitlist page uses API route (Convex mutation available in `useAddToWaitlist` hook)

**Keep Products Active**: Products remain active even when inventory = 0, just show waitlist form instead of purchase.

**Reference**: apps/marketing has similar waitlist implementation using `marketing_waitlist` table

**Estimated Time**: 2-3 days (completed)

---

## 📋 Development Order (Recommended)

Based on the plan in `mentorship-platform-plan.md`:

1. ✅ **Database schema** - DONE (Supabase)
2. ✅ **Database migrations** - DONE (applied to Supabase)
3. ✅ **Session pack + seat logic** - DONE (implemented with Inngest functions)
4. ✅ **Stripe one-time checkout** - DONE (fully implemented with webhooks)
5. ✅ **Stripe Webhooks** - DONE (integrated with Inngest)
6. ✅ **Instructor Session Management** - DONE (dashboard, sessions page, API)
7. ✅ **PayPal one-time checkout** - DONE (fully implemented with webhooks)
8. ✅ **Booking system + Google Calendar scheduling** - DONE (availability + booking + settings)
9. ✅ **Platform-wide security/rate limiting** - DONE (Upstash/Redis middleware policy matrix)
10. ✅ **Observability** - DONE (Axiom + Better Stack)
11. ✅ **Onboarding (email + form)** - DONE (purchase email + onboarding submissions)
12. ✅ **Discord automation + expanded notifications** - DONE (consume `discord_action_queue`, Discord delivery for `notification/send`)
13. ✅ **Manual session count tracking (Kajabi mentees)** - DONE (PR #137)
14. ✅ **Convex migration** - COMPLETED (database + real-time + file storage) (PR #139)
15. ✅ **Mentorship workspace UI (notes + links + images + messages)** - COMPLETED (frontend built on Convex)
16. ✅ **Workspace P1 bug fixes** - Auth, image filter, retention, counter decrements
17. ✅ **ZIP export for workspace images + notes** - COMPLETED (Trigger.dev task)
18. ✅ **Inventory management** - COMPLETED (Convex backend + admin UI + waitlist)
19. ✅ **Waitlist system** - COMPLETED (Convex + Resend + sold-out UI)
20. ⏳ **Discord Bot Slash Commands** - NOT STARTED (apps/bot not created)
21. ⏳ **Video access control** - NOT STARTED (apps/video not created)

---

## 🎯 Immediate Next Steps

1. **✅ Session pack & seat logic** (completed with Inngest functions)
2. **✅ Stripe payment integration** (completed - core revenue feature)
3. **✅ Instructor session management** (completed - dashboard, sessions page, API)
4. **✅ PayPal integration** (secondary payment option) - COMPLETED
5. ✅ **Row Level Security (RLS) enabled** - All tables secured with proper policies
6. ✅ **Upstash/Redis platform-wide security/rate limiting** (middleware policy matrix)
7. ✅ **Observability (Axiom + Better Stack)** (errors + rate limit failures)
8. ✅ **Discord automation + expanded notifications** - COMPLETED
9. ✅ **Manual session count tracking (Kajabi mentees)** - COMPLETED (PR #137)
10. ✅ **Convex migration (database + real-time)** - COMPLETED (Phase 1-3)
11. ✅ **Mentorship workspace UI (Chat + Notes + Images)** - COMPLETED
12. ✅ **Workspace P1 bug fixes** - Auth, image filter, retention, counters
13. ✅ **ZIP export for workspace images + notes** - COMPLETED (Trigger.dev task)
14. ✅ **Inventory + Waitlist System** - COMPLETED
    - Convex schema + queries/mutations
    - Admin UI (create/edit form + dedicated inventory page)
    - Inventory decrement on purchase
    - Waitlist backend (Convex + Resend emails)
    - Sold-out handling on instructor pages
15. ⏳ **Discord Bot Slash Commands** - NOT STARTED (apps/bot not created)
16. ⏳ **Video access control** - NOT STARTED (apps/video not created)


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

## 🚧 Remaining Items to Tackle

### Phase 4E: Admin Routes Convex Migration (In Progress)

| Phase | Status | Routes | Notes |
|-------|--------|--------|-------|
| **4E-1: Low-Risk Singles** | ✅ COMPLETED | 5 routes | Testimonials CRUD, mentee-results CRUD, upload import fix |
| **4E-2: Medium-Risk CRUD** | ⏳ DEFERRED | 5 routes | mentors table, session-count routes, waitlist, inventory read |
| **4E-3: Complex Admin Routes** | ✅ COMPLETED | 4 routes | Instructors list/create, inventory write, mentees invite (PR #209) |
| **4E-4: Stats + Critical Paths** | ✅ COMPLETED | 6 routes | Admin stats/mentees/orders/instructors/products → SQL (PR #232) |

**Remaining @mentorships/db imports**: ~8 routes still using Drizzle (refunds POST, products POST, workspaces mutations, session management)

**Architectural Decision (May 8, 2026)**: Admin READ endpoints migrated from Convex to SQL/Drizzle for analytical workloads. Convex remains for WRITE operations (creates, updates, refunds) and transactional multi-step operations. This follows the principle: SQL for aggregations/analytics, Convex for real-time sync and mutations.

**Migration Pattern Applied**:
- `GET /api/admin/stats` → SQL (`getAdminStats()`) ✅
- `GET /api/admin/mentees` → SQL (`getAdminMentees()`) ✅
- `GET /api/admin/orders` → SQL (`getAdminOrders()`) ✅
- `GET /api/admin/instructors` → SQL (`getAdminInstructors()`) ✅
- `GET /api/admin/products` → SQL (`getAdminProducts()`) ✅ (FIXED N+1 query problem)
- `POST /api/admin/instructors` → Convex mutation (creates instructor + Clerk invitation) ✅
- `POST /api/admin/refunds` → Convex mutation + Stripe/PayPal API calls ✅
- `POST /api/admin/products` → Convex mutation + Stripe/PayPal API calls ✅ (STAYS - multi-provider orchestration)

### Not Started (requires app creation)

| Feature | Status | Notes |
|--------|--------|-------|
| **Discord Bot Slash Commands** | ❌ NOT STARTED | `apps/bot` directory doesn't exist. Implement `/pack-purchased`, `/session-completed`, `/renewal-reminder`, `/grace-warning` |
| **Video Access Control (Agora/Daily.co)** | ❌ NOT STARTED | `apps/video` directory doesn't exist. Set up token generation + access control |

### Testing Required (untested in sandbox)

| Feature | Status | Notes |
|--------|--------|-------|
| **Payment Flow Testing** | 🟡 IN PROGRESS | Fixed PayPal Inngest registration, capture fallback, signature verification |
| **Instructor Active Toggle Testing** | ⏳ Untested | Deactivation edge cases need testing |

### Lower Priority Enhancements

| Feature | Status | Notes |
|--------|--------|-------|
| **Docstring Coverage** | Low priority | 28.57% → 80% threshold |
| **Type Safety in Create Page** | Low priority | Replace `any` with discriminated unions |

---

## 🎯 SQL/Drizzle vs Convex Decision Framework

### When to Use SQL/Drizzle (Analytics & Aggregations)
- **Admin dashboard reads** - stats, paginated lists with filtering
- **Complex JOINs** - data spread across multiple tables
- **Aggregation queries** - counts, sums, revenue calculations
- **Period comparisons** - month-over-month, year-over-year

### When to Use Convex (Real-time & Mutations)
- **All writes** - Create, update, delete operations
- **Real-time features** - workspace chat, live updates
- **Multi-step mutations** - creates that orchestrate external APIs (Stripe + PayPal + Convex)
- **Single-record CRUD** - product by ID, instructor by ID
- **External API orchestration** - Google Calendar, Stripe, PayPal calls

### Current Split (apps/web/api/admin)
**SQL/Drizzle** (READ - analytics):
- `GET /api/admin/stats` → `getAdminStats()`
- `GET /api/admin/mentees` → `getAdminMentees()`
- `GET /api/admin/orders` → `getAdminOrders()` (bugfix: PR #233)
- `GET /api/admin/instructors` → `getAdminInstructors()`
- `GET /api/admin/products` → `getAdminProducts()`

**Convex** (WRITE - transactional):
- `POST /api/admin/products` → creates in Stripe + PayPal + Convex
- `POST /api/admin/refunds` → Convex mutation + Stripe/PayPal API calls
- `POST /api/admin/instructors` → creates instructor + Clerk invitation
- `POST /api/admin/workspaces/*` → workspace CRUD

### Remaining Items (~8 routes with @mentorships/db imports)
These are mostly writes correctly placed in Convex. No urgent migrations needed.

---

## 🔧 Testing Required (Sandbox Mode)

### Payment Flow Testing (Sandbox Mode)
- [ ] **Stripe Checkout**: Test complete checkout flow in Stripe sandbox
- [ ] **PayPal Checkout**: Test complete checkout flow with PayPal
- [ ] **Refund Processing**: Test refund initiated from admin panel
- [ ] **Webhook Handling**: Verify Stripe/PayPal webhooks process correctly

### Instructor Active Toggle Testing
- [ ] **Deactivate with Active Mentees**: Verify blocking when instructor has active mentees (remaining sessions > 0)
- [ ] **Deactivate with Active Products**: Test modal appears when instructor has Stripe/PayPal products
- [ ] **Product Deactivation**: Verify products are deactivated on Stripe when confirmed
- [ ] **Failed Deactivation Handling**: Test UI when Stripe product deactivation fails
- [ ] **404 for Inactive Instructors**: Verify inactive instructors return 404 on public pages

### Recent Instructor Changes (April 15, 2026)
- Added `mentorId` column to `instructors` table (migration: `0022_add_instructor_mentor_id.sql`)
- Added validation to prevent deactivating instructors with active mentees
- Added validation to handle active Stripe products when deactivating
- Updated `getInstructorBySlug` to filter hidden/inactive instructors

---

**Next**: Source of Truth Migration (Phase 1: Add missing Convex tables + write migration scripts)

**Recent Fix (May 8, 2026)**:
- Fixed 500 errors on `/api/admin/stats` by migrating from Convex N+1 queries to efficient SQL aggregation
- `getStats` Convex query was calling `.collect()` on entire `seatReservations` and `payments` tables, then doing N individual `db.get()` calls per row
- Now uses proper SQL JOINs and aggregation functions (COUNT, SUM, GROUP BY)
- PR #231 also fixed N+1 in `getAdminOrders` (101 queries → 2 queries per page)

---

## 🔧 Payment Flow Improvements (April 26, 2026)

### Completed Fixes

1. **PayPal Inngest Registration** ✅
   - Added `processPayPalCheckout` and `processPayPalRefund` to Inngest serve
   - File: `apps/web/app/api/inngest/route.ts`

2. **PayPal Capture Inngest Fallback** ✅
   - Added direct Inngest event send after successful capture
   - Dual-path fulfillment: capture endpoint + webhook (both idempotent)
   - File: `apps/web/app/api/checkout/paypal/capture/route.ts`

3. **PayPal Signature Verification** ✅
   - Implemented full cryptographic verification using CRC32 + certificate
   - Certificate caching for 5 hours
   - File: `packages/payments/src/paypal/webhooks.ts`

4. **Environment** ✅
   - Added `PAYPAL_WEBHOOK_ID` comment to `.env.local`

5. **Critical Bugs Fixed** (April 26, 2026) ✅
   - Fixed `products.mentorId` type: was `v.id("instructors")` but schema uses string
   - Fixed all product queries to accept `v.string()` for mentorId
   - Fixed duplicate function definitions in convex/products.ts

### Product Creation (Admin UI)

The admin UI at `/admin/products/create` can create products WITH Stripe/PayPal integration:
- Check "Enable Stripe" to automatically create Stripe product/price
- Check "Enable PayPal" to automatically create PayPal product
- Just need to select mentor and fill in product details

**Dashboard Links**: After creating a product, the UI displays clickable links to:
- **Stripe**: "View Product" → `https://dashboard.stripe.com/products/{productId}`
- **Stripe**: "View Price" → `https://dashboard.stripe.com/prices/{priceId}`
- **PayPal**: "View in PayPal Dashboard" → `https://www.sandbox.paypal.com/myaccount/integrationproducts/{productId}`

### Testing Requirements

- [x] Product creation admin UI fixed and working
- [ ] Configure PayPal webhook in PayPal Developer Dashboard
- [ ] Add `PAYPAL_WEBHOOK_ID` to environment
- [x] Deploy to Vercel dev environment (PRs #185, #186 merged)
- [ ] Test Stripe checkout flow
- [ ] Test PayPal checkout flow
- [ ] Verify session pack creation
- [ ] Verify seat reservation creation
- [ ] Verify inventory decrement
- [ ] Test refund flow

---

## 📊 Recent Progress Summary

### May 2026
- ✅ **Phase 4E-3: Admin Instructor Sub-Routes Migration to Convex** (COMPLETED - May 4, 2026)
  - Migrated 4 admin routes to Convex (Phase 4E-3):
    - `admin/instructors/mentors/route.ts` - GET mentors list (new `admin.getAllMentors` query)
    - `admin/waitlist/route.ts` - GET/PATCH waitlist endpoints (uses existing waitlist functions)
    - `admin/mentees/[userId]/session-count/route.ts` - Full CRUD (new `menteeSessionCounts` table)
    - `admin/instructors/[id]/testimonials/route.ts` - POST/DELETE testimonials
    - `admin/instructors/[id]/mentee-results/route.ts` - POST/DELETE mentee results
  - New Convex: `menteeSessionCounts` table with indexes, `convex/admin.ts: getAllMentors` query
  - Bug fixes: P0 auth (removed redundant mutation auth since routes check admin), P1 type cast (use mutation return directly)
  - Fixed P2: COURSES_URL fallback intentionally changed to root domain (commit 3a32b4d)
  - CI checks: All passed (Lint, Unit Tests, E2E Tests, Build, Vercel deployments Ready)
  - Reference: PR #209

- ✅ **Phase 4B: Instructor/Public Routes Migration to Convex** (COMPLETED - May 2, 2026)
  - Migrated instructor and public routes away from Drizzle (@mentorships/db)
  - Fixed TypeScript type errors in instructor API routes
  - Fixed profileImageUploadPath response (not in Convex schema)
  - Pass user.id instead of user object to getInstructorByUserId
  - Multiple CodeRabbit review comment fixes
  - Reference: PR #205

- ✅ **Phase 4D: User Settings + Additional Fixes** (COMPLETED - May 2, 2026)
  - Migrated user settings PATCH to Convex
  - All API routes in apps/web/app/api/* have been migrated away from Drizzle except remaining admin routes (Phase 4E)

- ✅ **Phase 4E-1: Admin Low-Risk Routes Migration to Convex** (COMPLETED - May 3, 2026)
  - Migrated 5 low-risk admin routes to Convex (fetchQuery/fetchMutation pattern):
    - `admin/instructors/[id]/testimonials/route.ts` (POST) - create testimonial
    - `admin/instructors/[id]/testimonials/[testimonialId]/route.ts` (DELETE) - delete testimonial
    - `admin/instructors/[id]/mentee-results/route.ts` (POST) - create mentee result
    - `admin/instructors/[id]/mentee-results/[resultId]/route.ts` (DELETE) - delete mentee result
    - `admin/instructors/upload/route.ts` - error type import fix only
  - Updated Convex mutations to return full documents instead of just Ids:
    - `instructors.createTestimonial` now returns testimonial document
    - `instructors.createMenteeResult` now returns mentee result document
    - `instructors.createMenteeResultWithStorage` now returns mentee result document
  - Replaced @mentorships/db imports with @/lib/errors for error types
  - TypeScript typecheck passes, build succeeds
  - CI checks: All passed (Lint, Unit Tests, E2E Tests, Build, Vercel deployments Ready)
  - Reference: PR #206

### April 2026
- ✅ **Preview Page Redesign (Underpaint-style)** (COMPLETED - April 26, 2026)
  - **Goal**: Mirror https://underpaintacademy.com layout at `/preview` using Huckleberry content from https://home.huckleberry.art
  - New `StoreGrid` component (`apps/web/components/landing-preview/store-grid.tsx`): 6-card product grid with images, titles, links to Kajabi/store/discord (no prices — source unavailable)
  - `SaleBanner` overhaul: replaced all placeholder items with real promo data from home.huckleberry.art (Special Course Bundle 67% OFF, New Course 54% OFF, 58% OFF); added real countdown end date (May 5th) for the two sale items; capped display at 3 cards to match Underpaint's layout
  - Reordered `/preview` to match Underpaint flow: Hero → Promo (3-card) → Store Grid → Instructor Showcase → Newsletter → Footer; removed HowItWorks and Testimonials to stay focused
  - Tailwind 3.4.x-compatible throughout (no plugin changes); typecheck passes
  - Files: new `store-grid.tsx`, modified `sale-banner.tsx`, modified `preview/page.tsx`
  - Assets reused from `apps/web/public/images/preview/` (sale-bundle, sale-new-course-1/2, sale-drawing-course, mentor-kim-myatt, discord-banner)

- ✅ **Preview Page: Carousel + Paper Texture** (COMPLETED - April 27, 2026)
  - Added subtle paper-textured background using CSS radial gradients (double-layer dot pattern at different sizes/positions, anchored to viewport) to give a tactile paper-like feel beneath entire page
  - Converted static Hero to 3-slide carousel using existing Embla-based ui/carousel:
    - Slide 1: Neil Gray's Course Bundle (67% OFF) → bundle link
    - Slide 2: Drawing Drapery and Clothing with Neil Gray (54% OFF) → link to course page
    - Slide 3: Character Design with Neil Gray (58% OFF) → same course link
  - Shared countdown timer at top of carousel matching SaleBanner style (ends May 5, 2026)
  - Sale CTA button above timer linking to bundle offer: "Neil Gray Courses Sale · Up to 67% Off"
  - Auto-advances every 6s with manual prev/next controls
  - Files: modified `preview-hero.tsx`, modified `preview/page.tsx` (texture wrapper)

- ✅ **Inventory + Waitlist System** (COMPLETED - April 2026)
  - **Phase 1 COMPLETE**: Convex backend
    - Added `marketingWaitlist` table to Convex schema
    - Created waitlist queries/mutations in `convex/waitlist.ts`
    - Added inventory HTTP endpoints (`/inventory/decrement`, `/inventory/increment`, `/inventory/set`, `/waitlist/notify`)
    - Created frontend hooks: `use-mentors.ts`, `use-waitlist.ts`
    - Type normalization: converts 'one-on-one' to 'oneOnOne' for consistent inventory handling
  - **Phase 2 COMPLETE**: Inngest Integration
    - Added `mentorshipType` column to `sessionPacks` table for refund lookup
    - Inventory decrement after seat reservation in payment flow (Stripe + PayPal)
    - Inventory increment + waitlist notification on refund (Stripe + PayPal)
    - Added `CONVEX_URL` and `CONVEX_HTTP_KEY` environment variables
  - **Phase 3 COMPLETE** (April 2026): Admin UI
    - Inventory tab on instructor create/edit forms with One-on-One and Group inventory fields
    - Dedicated `/admin/inventory` page with inline editing (+/- buttons, direct input)
    - Waitlist actions: "Notify Waitlist" and "View Waitlist" modal
    - Resend email template at `apps/web/lib/email/waitlist-notification.ts`
  - **Phase 4 COMPLETE** (April 2026): Sold-out UI
    - `/instructors/[slug]` shows waitlist button when inventory = 0
    - Waitlist form at `/waitlist` page

- ✅ **Workspace Retention Warning Banner** (COMPLETED - April 2026)
  - In-app banner shows at 90/30/7 days before workspace content deletion
  - Component at `apps/web/components/workspace/retention-warning-banner.tsx`
  - Trigger.dev task at `src/trigger/workspace-retention.ts` sends email reminders

- ✅ **Mentor → Instructor Convex Function Naming Cleanup (Option B)** (COMPLETED - April 29, 2026)
  - **Approach**: Pragmatic cleanup - rename internal function names and variables only, no schema migrations
  - **Why**: The `instructors` table was already named correctly; confusion came from `getMentor*` function names vs public "instructor" branding
  - **Renamed Functions** (6 total):
    - `convex/sessions.ts`: `getMentorSessions` → `getInstructorSessions`
    - `convex/seatReservations.ts`: `getMentorSeatReservations` → `getInstructorSeatReservations`
    - `convex/seatReservations.ts`: `getMentorActiveSeats` → `getInstructorActiveSeats`
    - `convex/seatReservations.ts`: `getUserMentorSeat` → `getUserInstructorSeat`
    - `convex/sessionPacks.ts`: `getMentorSessionPacks` → `getInstructorSessionPacks`
    - `convex/workspaces.ts`: `getMentorWorkspaces` → `getInstructorWorkspaces`
  - **Updated Constants**:
    - `convex/workspaces.ts`: `WORKSPACE_IMAGE_CAPS.mentor` → `WORKSPACE_IMAGE_CAPS.instructor`
  - **Updated Variables**:
    - `convex/adminWorkspaces.ts`: `mentorIds` → `instructorIds`, `mentorsMap` → `instructorsMap`
  - **Updated Client Hooks**:
    - `apps/web/lib/queries/convex/use-sessions.ts`: `api.sessions.getInstructorSessions`
    - `apps/web/lib/queries/convex/use-session-packs.ts`: `api.sessionPacks.getInstructorSessionPacks`
    - `apps/web/lib/queries/convex/use-workspaces.ts`: `api.workspaces.getInstructorWorkspaces`
  - **NOT Changed** (per Option B - pragmatic approach):
    - `mentorId` field names on tables (would require Convex migration)
    - `users.role: "mentor"` literal (backwards compatible)
    - `workspaceMessages.senderRole: "mentor"` literal
    - `products.mentorshipType` field (refers to session type, not role)
  - **Reference**: PR #197

- ✅ **Phase 4A: API Route Migration - Checkout Routes** (COMPLETED - April 30, 2026)
   - **Goal**: Migrate checkout/payment-critical routes from Drizzle/Supabase to Convex
   - **Migrated routes** (PR #202):
     - `checkout/stripe` - Create Stripe checkout sessions
     - `checkout/paypal` - Create PayPal orders
     - `checkout/verify` - Verify checkout sessions
     - `checkout/cancel` - Cancel checkout (now requires auth - P1 security fix)
     - `checkout/success` - Handle successful checkout (now verifies order exists - P2 fix)
     - `checkout/paypal/capture` - Capture PayPal payment
     - `products/by-stripe-price` - Get product by Stripe price ID
     - `session-packs` - List session packs
     - `session-packs/me` - Get user's session packs
   - **Infrastructure changes**:
     - Created `lib/errors.ts` with UnauthorizedError/ForbiddenError classes
     - Created `lib/convex.ts` for shared getConvexClient (eliminates duplication)
     - Updated `lib/auth-helpers.ts` and `lib/auth.ts` to remove @mentorships/db imports
   - **Security fixes**:
     - P1: Added requireAuth to checkout/cancel (was public)
     - P2: Added order existence verification in checkout/success before redirect
     - Fixed: Replaced redirect() with NextResponse.redirect() to avoid try/catch issues

- ✅ **Phase 4A: API Route Migration - Admin Routes** (COMPLETED - April 30, 2026)
   - **Migrated routes** (PR #203):
     - `admin/products/[id]` - GET/PUT product (uses Convex getProductForAdmin + updateProduct)
     - `admin/orders` - GET orders list (uses Convex getOrdersForAdmin)
     - `admin/refunds` - POST refund (keeps Stripe/PayPal calls, uses Convex adminProcessRefund)
   - **New Convex functions**:
     - `convex/products.ts`: `getProductForAdmin` - product with instructor name for admin
     - `convex/orders.ts`: `getOrdersForAdmin` - paginated orders with user + payment info
     - `convex/payments.ts`: `adminProcessRefund` - handles payment/order DB updates
   - **Approach**: External API calls (Stripe/PayPal) stay in routes; DB operations move to Convex

- 🚧 **Booking Functionality Completion** (PENDING)
  - Instructor detail pages now read from Convex (instructorProfiles has data, getInstructorBySlug works)
  - But full booking requires:
    1. **Instructor records** in `instructors` table (with `mentorId` linked to `instructorProfiles`)
    2. **Products** for each instructor (pricing, Stripe/PayPal IDs)
    3. **Inventory counts** set on instructor records
  - Currently: `instructorProfiles.mentorId` is NOT set, `instructors` table is empty, `products` table is empty
  - **Option B (Full Convex migration)** decided: checkout mutations will also move to Convex (separate session)

### Phase 4: Convex API Route Migration - Remaining Work

**Status**: Phase 4D complete - all main API route categories migrated

**Completed**:
- ✅ Phase 4A-1: Checkout routes (stripe, paypal, verify, cancel, success, capture)
- ✅ Phase 4A-2: Admin routes (products/[id], orders, refunds)
- ✅ Phase 4B: Instructor/mentee routes (testimonials, mentees-results, sessions, session-counts) - COMPLETED May 2, 2026
- ✅ Phase 4D: Public routes + user settings + type fixes - COMPLETED May 2, 2026 (PR #205)
- ~14 @mentorships/db imports removed (Phase 4A)
- Additional ~14+ @mentorships/db imports removed (Phases 4B, 4D)

**Remaining (17 imports still using @mentorships/db)**:
- **4E-1: Admin low-risk routes (COMPLETED May 3, 2026)** ✅
  - admin/instructors/[id]/testimonials POST/DELETE
  - admin/instructors/[id]/mentee-results POST/DELETE
  - admin/instructors/upload (error types only)
- **4E-2: Admin medium-risk routes** - DEFERRED
  - instructors, mentees, inventory, waitlist, stats, mentors
  - Complex cross-table queries (instructors ↔ mentors ↔ sessionPacks)
  - Stripe/PayPal integration concerns
- **Other remaining routes**:
  - `/api/instructor/mentees/session-counts/[userId]/route.ts`
  - `/api/sessions/route.ts`
  - `/api/contacts/route.ts`
  - `/api/products/create-from-stripe/route.ts`
  - `/api/auth/sync/route.ts`
  - `/api/health/db/route.ts`
  - `/api/onboarding/submit/route.ts`
  - `/api/onboarding/submissions/[submissionId]/signed-urls/route.ts`
  - `/api/instructor/onboarding/review/route.ts`
  - `/api/auth/google/route.ts`
  - `/api/auth/google/callback/route.ts`

**Approach for remaining routes**:
1. Create Convex functions BEFORE migrating each route
2. Use multiple sessions (4A-1, 4A-2, 4A-3...) to avoid blocking
3. Keep Stripe/PayPal API calls in routes; move only DB ops to Convex
4. Create PR, wait 3 minutes, fix failed CI checks, fix PR conflicts

**Testing**: Manual smoke test of checkout + admin flows (Phase 4A-3) - PENDING

---

### Phase 4E: Admin Routes Migration - Deferred (Detailed Analysis)

**Status**: DEFERRED - 15+ admin routes still use Clerk auth + Supabase queries directly

**Why Deferred**:
- Complex cross-table queries (instructors ↔ mentors ↔ sessionPacks)
- Stripe/PayPal integration concerns (payment processing, product management)
- Instructor management requires deep understanding of existing Clerk+Supabase auth patterns

**Routes in Scope (15 admin routes)**:

| Route | Risk Level | Key Concerns |
|-------|------------|--------------|
| `admin/instructors/route.ts` | HIGH | Cross-table writes (instructors + mentors), active mentee validation, Clerk invitations |
| `admin/instructors/[id]/route.ts` | HIGH | Product deactivation (Stripe/PayPal), active student checks |
| `admin/instructors/mentors/route.ts` | MEDIUM | Direct mentors table CRUD |
| `admin/instructors/[id]/create-instructor-booking/route.ts` | HIGH | Stripe/PayPal product creation, cross-table booking logic |
| `admin/instructors/[id]/testimonials/route.ts` | LOW | Single table CRUD |
| `admin/instructors/[id]/mentee-results/route.ts` | LOW | Single table CRUD |
| `admin/mentees/route.ts` | MEDIUM | Cross-table queries |
| `admin/mentees/[userId]/session-count/route.ts` | MEDIUM | Session count validation |
| `admin/mentees/invite/route.ts` | MEDIUM | Clerk invitation integration |
| `admin/inventory/route.ts` | MEDIUM | Inventory management, waitlist triggering |
| `admin/waitlist/route.ts` | MEDIUM | Waitlist management, email notifications |
| `admin/stats/route.ts` | HIGH | Complex SQL aggregations (revenue, active mentees, monthly comparisons) |
| `admin/instructors/upload/route.ts` | LOW | Already mostly Convex (only uses error types from @mentorships/db) |
| `admin/instructors/[id]/testimonials/[testimonialId]/route.ts` | LOW | Single table delete |
| `admin/instructors/[id]/mentee-results/[resultId]/route.ts` | LOW | Single table delete |

**Identified Risks**:

1. **Financial Blast Radius** (HIGH)
   - Routes that deactivate Stripe/PayPal products could break payment flow
   - Routes that modify instructor active status affect booking availability
   - Mitigation: Migration should happen in small PRs with thorough testing; keep Stripe/PayPal calls in routes

2. **Cross-Table Transaction Complexity** (HIGH)
   - `admin/instructors/route.ts` POST does: insert instructor → insert mentor → update instructor with mentorId → dispatch Inngest event
   - `admin/stats/route.ts` does: 5 separate aggregation queries across payments, sessionPacks, seatReservations
   - Mitigation: Create Convex mutations that handle transactions atomically; use Convex query aggregations

3. **Auth Pattern Changes** (MEDIUM)
   - Currently uses `requireRoleForApi("admin")` from `@/lib/auth-helpers`
   - Convex functions use `ctx.auth.getUserIdentity()` with custom role checking
   - Mitigation: Ensure auth helpers are updated consistently across all routes

4. **Data Consistency During Migration** (MEDIUM)
   - Dual-write period: some data in Supabase, some in Convex
   - Order creation flow touches: orders (Supabase), sessionPacks (Convex), seatReservations (Convex)
   - Mitigation: Migrate one table at a time; maintain consistency through Inngest events

5. **Stripe/PayPal Product Sync** (HIGH)
   - Product creation/deactivation syncs to Stripe/PayPal
   - Product prices linked to session pack inventory
   - Mitigation: Keep external API calls in routes; only move DB operations to Convex

**Recommended Migration Order** (lowest risk first):

1. **Phase 4E-1: Low-Risk Singles** (5 routes)
   - testimonial create/delete
   - mentee-results create/delete
   - upload route (error types only)

2. **Phase 4E-2: Medium-Risk CRUD** (5 routes)
   - mentors table direct CRUD
   - session-count routes
   - waitlist routes
   - inventory read routes

3. **Phase 4E-3: Complex Admin Routes** (4 routes)
   - instructors list/create (high risk - Clerk invitations)
   - inventory write routes (waitlist notifications)
   - mentees invite (Clerk invitations)

4. **Phase 4E-4: Stats + Critical Paths** (1 route)
   - admin/stats (complex aggregations)
   - instructors/[id] PUT (Stripe product deactivation)

**Migration Strategy**:
1. Create Convex functions for each table/route BEFORE migrating
2. Test each route in isolation before moving to next
3. Keep Stripe/PayPal calls in API routes (only move DB ops to Convex)
4. Use feature flags or gradual rollout for critical routes
5. Full smoke test after each phase

**Alternative Consideration**:
- Could defer Phase 4E indefinitely since:
  - Checkout flow (revenue-critical) already migrated to Convex
  - Admin routes are internal tooling, not customer-facing
  - Drizzle/Supabase still functional and maintained
  - Only pay off technical debt when it causes pain

---

- ✅ **Minor Enhancements** (COMPLETED - April 2026)
  - Pagination in admin workspace list (`useInfiniteQuery`)
  - Pagination in admin audit log list (`useInfiniteQuery`)
  - Search debouncing on workspace creation page (`useDebouncedValue`)

- ⏳ **Discord Bot Slash Commands** - NOT STARTED
  - `apps/bot` directory does not exist
  - Would implement `/pack-purchased`, `/session-completed`, `/renewal-reminder`, `/grace-warning`

- ⏳ **Video Access Control** - NOT STARTED
  - `apps/video` directory does not exist
  - Would integrate Agora or Daily.co for video access control

- 🚧 **Convex Migration Decision** (Major Architecture Change)
  - Decided to migrate from Supabase/PostgreSQL to Convex
  - Rationale: Real-time by default, simpler DX, built-in file storage, better for workspace features
  - Services unchanged: Clerk (auth), Resend (email), Stripe/PayPal (payments), Trigger.dev (background jobs), Upstash/Redis (rate limiting), Backblaze B2 + Cloudflare (video storage)
  - Video calls: TBD (Agora or Amazon Chime) - remains on roadmap
  - Plan: Fresh start (no data migration needed), ~3-4 week implementation
  - Free tier initially ($0), upgrade when limits reached

- ✅ **Manual Session Count Tracking** (PR #137)
  - New `mentee_session_counts` table for manual session tracking
  - Admin API: CRUD for session counts at `/api/admin/mentees/[userId]/session-count`
  - Instructor API: Manage own mentee session counts at `/api/instructor/mentees/session-counts/[userId]`
  - Admin UI: "Set Sessions" button on `/admin/mentees` with proper input validation
  - Security fixes: BOLA vulnerability, race condition, unique constraint
  - Supports mentees who paid through Kajabi (not through app's Stripe/PayPal)

- ✅ **Instructor Management** (Admin + Dashboard)
  - Full CRUD for instructors via `/admin/instructors`
  - Create/edit forms with tabs (Basic Info, Images, Tags, Social Links, Testimonials, Results)
  - Predefined + custom tags for specialties and background
  - Social links: Twitter, Instagram, YouTube, Bluesky, Website, ArtStation
  - Testimonials management for admins and instructors
  - Mentee results (before/after images) for admins and instructors
  - TanStack Form + React Query + shadcn/ui components
  - Database: `instructors`, `instructor_testimonials`, `mentee_results` tables

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

---

## 📝 Remaining Enhancements (Admin Workspace)

The following enhancements were suggested during code review. Status updated April 2026:

### ✅ Completed
1. **Pagination in Admin Lists**
   - Implemented via `useInfiniteQuery` in workspace list and audit logs
   - Both pages use cursor-based pagination

2. **Search Debouncing**
   - Implemented in workspace creation page via `useDebouncedValue(search, 300)`

### Low Priority (Already Optimized)
3. **N+1 Query Optimization**
   - The `enrichWorkspaces` function in `convex/adminWorkspaces.ts` already batches owner/mentor lookups using `Promise.all()` - only 2 queries regardless of workspace count (one for all owners, one for all mentors)
   - No action needed - this was already optimized

### Not Yet Implemented (Lower Priority)
4. **Docstring Coverage**
   - CodeRabbit reports 28.57% docstring coverage (threshold: 80%)
5. **Type Safety in Create Page**
   - Replace `any` types with discriminated unions
   - File: `apps/web/app/admin/workspaces/create/page.tsx`

### Security (Already Addressed)
- ✅ Added admin role check to `getUserByUserId` query (prevents PII exposure)

(End of file - total 992 lines)

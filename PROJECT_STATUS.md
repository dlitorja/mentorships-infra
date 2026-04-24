# Mentorship Platform - Project Status & Next Steps

**Last Updated**: April 24, 2026  
**Status**: AI Crawl Control Implemented, Convex Migration Complete - Convex Schema + Query/Mutation Functions Complete, Payments + Booking + Google Calendar Scheduling Implemented, Security (Upstash/Redis) + Observability (Axiom/Better Stack) Implemented, Onboarding (Email + Form) Implemented, Notifications (Email + Discord) Implemented, Discord Automation (Queue Worker) Implemented, Instructor Management (Admin + Dashboard) Implemented, Manual Session Count Tracking (Kajabi Mentees) Implemented, **Workspace UI (Chat + Notes + Images) Implemented**, **ZIP Export for Workspace Images + Notes Implemented**, **Admin Workspace Access (Dual Workspaces + Audit Logging) COMPLETED**, **Inventory Management (Phases 1-2 COMPLETE, Admin UI IN PROGRESS)**, **Waitlist System (Phases 1-2 COMPLETE, Frontend IN PROGRESS)**, **Mentor → Instructor Terminology Migration (Frontend User-Facing Strings COMPLETE)**, Video Integration TBD

---

## 🏗️ Architecture Clarification

This monorepo contains multiple applications with distinct responsibilities:

| App | Responsibility |
|-----|---------------|
| **apps/marketing** | Public-facing marketing site, instructor profiles (`/instructors`), landing pages |
| **apps/web** | Dashboards (admin, instructor, mentee), payment flow (Stripe/PayPal), calendar booking |
| **apps/bot** | Discord bot (slash commands, automation) |
| **apps/video** | Video integration (Agora/Amazon Chime) |

**Potential Additions**:
- None currently

**Data flow (Current - Migrating)**:
- apps/marketing reads instructor data from static JSON
- apps/web manages all user data in Supabase via Drizzle ORM (MIGRATING to Convex)
- Both apps share the `@mentorships/db` package for database schema (MIGRATING to Convex)

**Data flow (Target - After Convex Migration)**:
- apps/marketing reads instructor data from Convex
- apps/web manages all user data in Convex (real-time queries, built-in reactivity)
- Auth via Clerk (unchanged), file storage via Convex Storage
- Video recordings remain on Backblaze B2 with Cloudflare egress

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
- API Routes (replaced with Convex queries/mutations)
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

**Not Yet Implemented**:
- Video call integration with chat sidebar
- In-app retention warning banner

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

### Priority 10: Inventory Management (Convex + Admin UI)
**Status**: 🚧 **IN PROGRESS** - Phases 1-2 COMPLETE, Admin UI in progress

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

**Phase 3: Admin UI**
- [ ] Add inventory fields to instructor create form (new "Inventory" tab)
- [ ] Add inventory fields to instructor edit form (new "Inventory" tab)
- [ ] Create `/admin/inventory` page:
  - Grid of mentor cards showing current inventory
  - Inline edit with +/- buttons and direct input
  - "Notify Waitlist" button per mentorship type
  - "View Waitlist" modal showing email list
- [ ] Add Convex query hooks: `useInstructorInventory`, `useUpdateInventory`

**UX Design**:
- Create form: Optional checkbox "Create mentor record for bookings" - when checked, creates both instructor AND mentor with default inventory 0
- Edit form: If instructor has linked mentorId, show inventory section - if not, show "Enable bookings" button to create mentor
- Admin inventory page: List all mentors (not just those with instructor profiles)

**Reference**: Similar to apps/marketing `/admin/inventory` implementation

**Estimated Time**: 3-4 days

---

### Priority 11: Waitlist System (Convex + Resend + Sold-Out UI)
**Status**: 🚧 **IN PROGRESS** - Phases 1-2 COMPLETE, Frontend in progress

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

**Phase 3: Frontend - Sold Out Handling**
- [ ] Create Inngest function to trigger waitlist notifications when inventory changes 0→N
- [ ] Send emails to all un-notified waitlisted users for that mentorship type
- [ ] Mark users as notified after sending

**Phase 3: Frontend - Sold Out Handling**
- [ ] Update apps/web `/instructors/[slug]` to check inventory from Convex
- [ ] Show waitlist form when inventory = 0 instead of "Buy" button
- [ ] Wire up waitlist submission to Convex mutation

**Keep Products Active**: Products remain active even when inventory = 0, just show waitlist form instead of purchase.

**Reference**: apps/marketing has similar waitlist implementation using `marketing_waitlist` table

**Estimated Time**: 2-3 days

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
18. 🚧 **Inventory management** - IN PROGRESS (Convex backend + admin UI)
19. 🚧 **Waitlist system** - IN PROGRESS (Convex + Resend + sold-out UI)
20. ⏳ **Video access control** - After inventory/waitlist (Daily.co recommended)

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
14. ⏳ **Inventory + Waitlist System** - IN PROGRESS
    - Convex schema + queries/mutations
    - Admin UI (create/edit form + dedicated inventory page)
    - Inventory decrement on purchase
    - Waitlist backend (Convex + Resend emails)
    - Sold-out handling on instructor pages
15. ⏳ **Video access control** - NEXT


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

## 🔧 Testing Required

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

**Next**: Inventory Management + Waitlist System (Priority 10-11), then Video access control, then in-app retention warning banner

---

## 📊 Recent Progress Summary

### April 2026
- ✅ **Inventory + Waitlist System** (Phases 1-2 COMPLETE)
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
  - **Remaining Phases**:
    - Phase 3: Add inventory tabs to create/edit forms
    - Phase 4: Create `/admin/inventory` page
    - Phase 5: Show waitlist form on instructor pages when inventory = 0
    - Phase 6: Resend template for waitlist notifications

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

The following enhancements were suggested during code review but are not blocking for merge:

### High Priority (Nice to Have)
1. **Pagination in Admin Lists**
   - Currently hardcoded to fetch 50/100 items
   - Could add cursor-based pagination to workspace list and audit logs
   - Files: `apps/web/app/admin/workspaces/page.tsx`, `apps/web/app/admin/audit-logs/page.tsx`

2. **Search Debouncing**
   - Add debounce to search input in workspace creation page
   - Prevents excessive API calls on keystroke
   - File: `apps/web/app/admin/workspaces/create/page.tsx`

### Medium Priority (Future Improvements)
3. **N+1 Query Optimization**
   - Currently makes serial Convex queries for owner/mentor lookups
   - Could batch lookups or denormalize display fields
   - File: `apps/web/app/api/admin/workspaces/route.ts`

4. **Docstring Coverage**
   - CodeRabbit reports 28.57% docstring coverage (threshold: 80%)
   - Add JSDoc comments to new functions

5. **Type Safety in Create Page**
   - Replace `any` types with discriminated unions
   - File: `apps/web/app/admin/workspaces/create/page.tsx`

### Security (Already Addressed)
- ✅ Added admin role check to `getUserByUserId` query (prevents PII exposure)


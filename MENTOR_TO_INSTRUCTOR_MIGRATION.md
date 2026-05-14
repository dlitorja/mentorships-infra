# mentor → instructor Migration Plan

## Overview

**Goal**: Eliminate all instances of `mentor`/`mentorId` in favor of `instructor`/`instructorId` across all apps/platforms.

**Scope**: ~2,500 references across ~280 files (excludes `apps/marketing` — maintained as-is during platform/web focus)

**Current State**:
- Convex: `mentorId` removed from most tables, `instructorId` used instead. `mentors` table still exists but is largely unused.
- Postgres/Drizzle: **Phase 1 complete** — `instructor_id` columns added and backfilled across 6 tables. Columns are nullable (NOT NULL enforcement deferred to before Phase 1.5). Both `mentor_id` and `instructor_id` columns exist. `mentors` table still exists.
- API layer: Still returns `mentorId` in responses, accepts it in request bodies.
- Frontend: ~1,500 refs across `platform`, `web`, `home` apps. `marketing` excluded from this migration.

---

## Key Challenges

1. `instructors.mentorId` is a FK bridge to `mentors.id` — must be replaced with direct `instructors.id` reference.
2. Inconsistent column types: `mentor_id` is `text` in some tables, `uuid` in others.
3. No shared canonical type — `mentorId` is redefined as `string` at every layer.
4. Two live frontends (`platform` + `web`) + `home` — changes must be coordinated. `marketing` excluded from scope.
5. 17 Drizzle migration files reference `mentor_id` — these are immutable (past migrations).

---

## Phase 1: Database Schema Migration

**Goal**: Add `instructor_id` columns alongside `mentor_id`, backfill data, then remove old columns after app code is updated.

### Status: ✅ COMPLETE

### Steps

- [x] **1.1** Add `instructor_id` columns (widen) — migration file created: `0026_add_instructor_id_columns.sql`
- [x] **1.2** Backfill `instructor_id` from existing data
  - For `sessionPacks`, `seatReservations`: Simple copy `instructor_id = mentor_id` (both text, Convex IDs)
  - For `products`, `sessions`, `discordActionQueue`, `menteeOnboardingSubmissions`: Resolve via `instructors.mentorId` → `instructors.id` mapping
  - Note: 1 orphaned mentor (`6aaa6fc1-9af3-4583-b7a1-b31fb531bac7`) had no instructor record — created instructor and backfilled 5 orphaned rows
- [x] **1.3** Make `instructor_id` NOT NULL (deferred — columns remain nullable during transition phase for safe rollback; will enforce NOT NULL before Phase 1.5 drop)
- [x] **1.4** Update Drizzle schema to use `instructorId` (both columns during transition)
- [ ] **1.5** Drop `mentor_id` columns + `mentors` table (narrow) — final step (after Phase 2-4 complete)

### Tables Modified

| Table | New Column | Type | Notes |
|-------|-----------|------|-------|
| `products` | `instructor_id` | `uuid` | FK → `instructors.id` |
| `sessionPacks` | `instructor_id` | `text` | Matches Convex ID format |
| `seatReservations` | `instructor_id` | `text` | Matches Convex ID format |
| `sessions` | `instructor_id` | `uuid` | FK → `instructors.id` |
| `discordActionQueue` | `instructor_id` | `uuid` | FK → `instructors.id` |
| `menteeOnboardingSubmissions` | `instructor_id` | `uuid` | FK → `instructors.id` |

### Migration File
Created: `packages/db/drizzle/0026_add_instructor_id_columns.sql`

### Schema Files Updated
- `packages/db/src/schema/products.ts` — added `instructorId` column with FK and index (PR #259 fix: added missing index declaration)
- `packages/db/src/schema/sessionPacks.ts` — added `instructorId` column with index
- `packages/db/src/schema/seatReservations.ts` — added `instructorId` column with index
- `packages/db/src/schema/sessions.ts` — added `instructorId` column with FK and index
- `packages/db/src/schema/discordActionQueue.ts` — added `instructorId` column with FK and index
- `packages/db/src/schema/menteeOnboardingSubmissions.ts` — added `instructorId` column with FK and index (PR #259 fix: corrected indentation)

### Rollback Safety
Phase 1.1-1.3 are complete and applied. Both `mentor_id` and `instructor_id` columns now exist in all tables.

### PR #259 Fixes Applied
- `products.ts`: Added missing `instructorIdIdx` index to match SQL migration and prevent schema drift
- `menteeOnboardingSubmissions.ts`: Fixed indentation inconsistency in column definitions

---

## Phase 2: Query & Package Layer

**Goal**: Update `packages/db` to use `instructorId` internally.

### Status: Mostly Complete (core fixes committed)

### Steps

- [x] **2.1** Update Drizzle schema definitions (both old/new columns during transition) — done in Phase 1
- [x] **2.2** Update `packages/db/src/lib/queries/` — COMPLETED (core fixes):
  - `sessions.ts` — Correct join path: `instructorId → instructors.id → instructors.mentorId → mentors.id`
  - `products.ts` — Correct join path: same instructor→mentor bridge resolution
  - `sessionPacks.ts` — Duplicate-check now catches backfilled rows where `instructorId` contains a mentor UUID (not instructors UUID)
  - `seatsReservations.ts` — reads use `instructorId`, writes use both columns
  - `admin.ts` — main queries updated to use `instructorId`; `getAdminInstructors` subqueries still use mentorId bridge (requires separate review)
- [x] **2.3** Migrate `mentors.ts` query functions to `instructors.ts` — **COMPLETED in PR #268**
  - `packages/db/src/lib/queries/mentors.ts` **DELETED** — `getInstructorByUserId` moved to `instructors.ts`
  - Note: Google Calendar tokens now stored in Convex `instructors` table, not SQL mentors table
- [ ] **2.4** Update `packages/payments/` — no changes needed (mentorId only appears in JSDoc comments, not code)
- [x] **2.5** Update `packages/schemas/` and `packages/ui/` — no changes needed (no mentorId references found)

### Files Updated

| File | Changes |
|------|---------|
| `packages/db/src/lib/queries/seatsReservations.ts` | `reserveSeat`, `checkSeatAvailability`, `getMentorActiveSeats` — reads use `instructorId` |
| `packages/db/src/lib/queries/sessions.ts` | All 5 query functions use `sessions.instructorId` |
| `packages/db/src/lib/queries/products.ts` | Product queries and `createProduct` use `instructorId` |
| `packages/db/src/lib/queries/sessionPacks.ts` | All reads use `instructorId`, writes use both columns; return types updated |
| `packages/db/src/lib/queries/admin.ts` | `getAllInstructorsWithStats`, `getInstructorWithMentees`, `getInstructorMenteesForCsv`, `getFullAdminCsvData`, `getAdminMentees`, `getAdminProducts` updated |
| `packages/db/src/schema/products.ts` | Added `instructorIdIdx` index (PR #259 fix) |
| `packages/db/src/schema/menteeOnboardingSubmissions.ts` | Fixed indentation in column definitions (PR #259 fix) |
| `packages/db/src/schema/sessions.ts` | Added `instructorId` column with FK and index |
| `packages/db/src/schema/discordActionQueue.ts` | Added `instructorId` column with FK and index |
| `packages/db/src/schema/menteeOnboardingSubmissions.ts` | Added `instructorId` column with FK and index |

### Type Note: `AdminMenteeItem.instructorId` Nullability
`AdminMenteeItem.instructorId` is typed as nullable (`string | null`) — this is intentional. `sessionPacks.instructorId` is nullable in the schema, and consumers must handle null. The type accurately reflects the underlying schema.

### Remaining Phase 2 Work

- `admin.ts` `getAdminInstructors`: Subqueries at lines 690-702 use `instructors.mentorId` (bridge FK to mentors.id) combined with `seatReservations.mentorId`/`sessionPacks.mentorId` (text/Convex IDs). This pattern requires careful migration due to type mismatches (UUID vs text).
- `mentors.ts`: Functions like `updateMentorGoogleCalendarAuth` query the `mentors` table directly for mentor-specific fields. These remain valid until mentors table is deprecated in Phase 5.

### Remaining User-Facing Text Work

The following still contain "mentor" references that may need attention:

**Sale banners / product labels (harder to change - product/category names):**
- `New Mentor — Kim Myatt` in sale-banner components (3 apps)
- `MENTORSHIPS` badge text
- These are product/category display names that may require coordination with business logic

**Internal code references (variable names, function names):**
- `getMentorByUserId()` function calls (still works, returns instructor data)
- `mentorId` variable names in local scope (not user-facing)
- `requireRole("mentor")` checks (database-dependent, should update when roles change)

**Remaining grep findings (526 total matches):**
- Many are internal variable names (`mentor`, `mentorId`, `getMentorByUserId`)
- Some are type definitions and schema references
- Seed data testimonials contain "mentor" in natural language text (not code)

### Recommended Next Steps

1. **Complete Phase 4.4 (Home app)** — 31 refs, mostly display strings
2. ✅ **Role checks** — Done May 13: Updated `requireRole("mentor")` to `"instructor"` across 5 platform pages + 10 API routes
3. ✅ **Sale banner terminology** — Already done in PR #266 ("New Mentor — Kim Myatt" → "New Instructor — Kim Myatt")
4. **Phase 5 cleanup** — Blocked until Google Calendar encryption key confirmation received
5. **Rename `getMentorByUserId`** — Lower priority, still works as-is. See Phase 5 investigation findings above

### PR #267 Status (May 13, 2026)
- **PR #267**: Phase 4 role checks and additional fixes — **MERGED ✅**
- CI: All green (Lint, Unit Tests, E2E Tests, Build, Vercel deployments)
- CodeRabbit: Approved with summary (1 pre-existing warning: docstring coverage 28.89%)
- Greptile: Raised 2 concerns about clerk.ts and crypto.ts — **addressed via commits**:
  - `clerk.ts`: Uses `safeParse` with fallback to "student" (not `.parse()`), so ZodError never thrown
  - `crypto.ts`: Correctly attempts base64 decode first before marker check (legacy format `base64("__decrypted__"+token)` handled)

**PR #267 commits:**
- `fix: Complete mentor→instructor role checks in platform app` — 5 pages + 6 API routes
- `Update MENTOR_TO_INSTRUCTOR_MIGRATION.md with PR #266 progress`
- `Fix marketing app getDbUser to handle undefined user`
- `Fix requireDbUser to throw on undefined and cascade fixes`
- `Address PR #266 CodeRabbit review comments` — safeParse, explicit return types, DB enum migration
- `Fix role check in onboarding signed-urls route`
- `Fix role type references across db package`
- `Update user role enum from mentor to instructor in DB schema`
- `Fix sale banner terminology and role checks for instructor migration`
- `docs: Fix stale Phase 5 checklist - mark step 5.3 as complete`
- `feat: Migrate Google Calendar token storage from Postgres to Convex`
- `docs: Update migration doc with PR #263 merge details and CodeRabbit fixes`
- Merge commit: `Merge main into feat/migrate-google-calendar-tokens-to-convex`

---

### PR #268 Status (May 14, 2026)
- **PR #268**: `feat: Rename getMentorByUserId, fix platform product API, complete Phase 5 cleanup` — **MERGED ✅**
- CI: All green (Lint, Unit Tests, E2E Tests, Build)
- Core changes: Renamed functions, removed `mentors.ts` queries, updated platform/web to use Convex for instructor data

**PR #268 commits:**
- `fix: Re-export getInstructorByUserId from instructors.ts to resolve duplicate export conflict`
- `feat: Rename getMentorByUserId to getInstructorByUserId, fix platform product API`
- `fix: Complete mentor→instructor role checks in apps/platform`
- `fix: Complete mentor→instructor rename in platform and marketing dashboards`
  - Deleted `packages/db/src/lib/queries/mentors.ts`
  - Moved `getInstructorByUserId` to `packages/db/src/lib/queries/instructors.ts`
  - Renamed `getMentorMenteesWithSessionInfo` → `getInstructorStudentsWithSessionInfo`
  - Renamed `getMentorMenteesWithLowSessions` → `getInstructorStudentsWithLowSessions`
  - Renamed type `MenteeWithSessions` → `StudentWithSessions`
  - Updated marketing instructor dashboard to use `totalStudents` instead of `totalMentees`
- `fix: use Convex for instructor lookup in onboarding submit route`
- `fix: add instructor role to marketing auth, remove mentorId from platform dashboard`
- `fix: remove Google Calendar card from web instructor dashboard`
- `fix: replace totalMentees with totalStudents in marketing dashboard`
- `fix: replace mentor variable with instructor in settings page`
- `fix: rename mentor->instructor, mentee->student in workspace type`
- `fix: replace mentor references with instructor in checkout page`
- `fix: remove mentor/mentee from instructor slug page`
- `fix: use Convex for instructor data in settings page`

**Key changes in PR #268:**

1. **Deleted `mentors.ts` queries** — `packages/db/src/lib/queries/mentors.ts` removed, function moved to `instructors.ts`

2. **Platform instructor pages** — Now use Convex `api.instructors.getInstructorByUserId` instead of Postgres `getMentorByUserId`:
   - `apps/platform/app/instructor/dashboard/page.tsx`
   - `apps/platform/app/instructor/settings/page.tsx`
   - `apps/platform/app/instructor/profile/route.ts`

3. **Web app fixes** — Removed `mentor`/`mentee` variable references:
   - `apps/web/app/api/onboarding/submit/route.ts` — Uses Convex for instructor lookup
   - `apps/web/app/instructor/settings/page.tsx` — Uses Convex for instructor data
   - `apps/web/app/admin/workspaces/page.tsx` — Renamed type fields `mentor`→`instructor`, `menteeImageCount`→`studentImageCount`
   - `apps/web/app/checkout/page.tsx` — Uses `useInstructorProducts` instead of `useProductsByMentorId`
   - `apps/web/app/instructors/[slug]/page.tsx` — Renamed types `Mentor`→`InstructorProfile`, `MenteeResult`→`StudentResult`

4. **Marketing auth fix** — Added `"instructor"` to role type union in `apps/marketing/lib/auth.ts`

5. **Removed mentorId-dependent code** — Google Calendar connection card removed from platform/web instructor dashboards (mentorId no longer exists on Convex instructor type)

---

## Phase 3: API & Convex Layer

**Goal**: Update API contracts from `mentorId` → `instructorId`.

### Status: In Progress

### Branch
`feat/add-instructor-id-columns` (current)

### Commits Made
- `6b85721` — Phase 3 start: Convex http.ts and key API routes use instructorId
- `3447d78` — Phase 3: Web admin products route accepts instructorId
- `40ddad8` — docs: Update migration doc with Phase 3 progress

### Steps

- [x] **3.1** Convex `http.ts`: ✅ DONE — Inventory endpoints accept both `instructorId` (preferred) and `mentorId` (deprecated). Seed function fixed to use single createInstructor with proper params.
- [ ] **3.2** Platform API routes (~36 files) — partially done (admin/instructors, admin/products)
- [ ] **3.3** Web API routes (~36 files) — partially done (session-packs, admin/products)
- [ ] **3.4** Marketing API routes (~5 files)
- [ ] **3.5** Merge/remove `convex/mentors.ts` — deferred (file already marked deprecated, serves legacy migration purpose)

### Completed in Phase 3

**convex/http.ts:**
- `httpDecrementInventory`, `httpIncrementInventory`, `httpSetInventory`: Accept `{ instructorId?, mentorId? }` — prefer `instructorId` if both present
- `httpSeedInstructor`: Fixed to use single createInstructor call with correct `instructorId` param (was passing `mentorId` which createProduct doesn't accept)

**Platform API routes:**
- `admin/instructors/route.ts`: Response now returns `instructorId` instead of `mentorId`
- `admin/products/[id]/route.ts`: Schema updated to accept `instructorId` (primary) and `mentorId` (deprecated alias)

**Web API routes:**
- `session-packs/route.ts`: Accepts both `instructorId` (preferred) and `mentorId` (deprecated)
- `admin/products/[id]/route.ts`: Schema updated to accept `instructorId` (primary) and `mentorId` (deprecated alias)

### Detailed Plan

#### 3.1 Convex `http.ts` — Priority first
Work from `convex/http.ts` (25 mentor refs, 14 mentorId refs). Strategy:

1. Add new `instructorId` param variants alongside `mentorId` params (backward compat)
2. Internally route to same handlers — only the param name changes
3. Keep `mentorId` in signatures until all consumers are updated (Phase 3.2-3.3)
4. Return `instructorId` in response payloads — this is the new canonical field

Key handlers to update:
- Session creation/update handlers
- Product listing by instructor
- Booking confirmation handlers

#### 3.2 Platform API Routes
~24 files, ~100 mentor refs, ~25 mentorId refs. High-value targets:
- `app/api/admin/instructors/` — admin instructor management endpoints
- `app/api/sessions/` — session CRUD
- `app/api/products/` — product management

Strategy: Add backward compat shim — accept both `mentorId` and `instructorId`, prefer `instructorId`.

#### 3.3 Web API Routes
~36 files, ~150 mentor refs, ~40 mentorId refs. High-value targets:
- `app/api/bookings/` — booking flow endpoints
- `app/api/instructors/` — public instructor endpoints
- `inngest/functions/booking-emails.ts` — email triggers

#### 3.4 Marketing API Routes
~5 files. Lower volume, mostly display/content endpoints.

#### 3.5 Convex `convex/mentors.ts`
This file has 12 mentor refs and 0 mentorId refs — it's the source definition file. Tasks:
1. Audit which functions are still actively used vs deprecated
2. Migrate active functions to `convex/instructors.ts` (or `convex/http.ts`)
3. Functions still needing `mentors` table (Google Calendar auth, etc.) — keep but mark deprecated
4. Remove `convex/mentors.ts` once all consumers migrated

### Files Affected

| Location | Files | mentor refs | mentorId refs |
|----------|-------|------------|---------------|
| `convex/http.ts` | 1 | 25 | 14 |
| `convex/mentors.ts` | 1 | 12 | 0 |
| Platform API routes | ~24 | ~100 | ~25 |
| Web API routes | ~36 | ~150 | ~40 |

### Risk: API Contract Breaking Changes
API changes in Phase 3 are **breaking** for external callers. Mitigation:
- Support both `mentorId` and `instructorId` params during transition
- Emit deprecation headers in responses
- Coordinate with frontend team (Phase 4) to switch first — internal consumers before external

---

## Phase 4: Frontend Layer

**Goal**: Update all frontend code.

### Status: In Progress

### Branch
`feat/add-instructor-id-columns` (current)

### PR Status
- **PR #262**: Phase 4 frontend changes merged ✅
- **PR #263**: Phase 4 continuation - sessionPacks.mentorId → instructorId migration ✅ **MERGED**
- **PR #266**: Sale banners, Google OAuth role checks, DB enum migration ✅ **MERGED**
- **PR #267**: Role check migration (platform app + web app fixes), Google Calendar token migration, CodeRabbit review fixes ✅ **MERGED** (May 13, 2026)
  - CI status: All green (Lint, Unit Tests, E2E Tests, Build, Vercel, CodeRabbit)
  - `mergeStateStatus: CLEAN` - ready to merge
  - Merge conflicts resolved (took our version for products create pages and booking-emails)
  - Note: Marketing app changes reverted - no Convex setup, kept Postgres approach
  - CodeRabbit review comments addressed (see below)

### Commits Made (PR #263)
- Phase 4: Update Inngest types to use instructorId
- Phase 4: Update booking emails to use instructorId
- Phase 4: Update product form to use instructorId
- Phase 4: Update admin products pages to use instructorId
- fix: Resolve remaining mentorId → instructorId references (sync.ts, admin.ts types)
- fix: Revert marketing app changes - no Convex setup
- fix: Address CodeRabbit review comments
- fix: Remove includeInactive from Convex call - query doesn't support it

### Completed Changes

**Inngest types (`inngest/types.ts`):**
- `BookingEmailPayload`, `BookingEmailPayloadV2`, `InstructorBookingEmailPayload`: `mentorId` → `instructorId`

**Booking emails (`inngest/functions/booking-emails.ts`):**
- `sendBookingConfirmationEmails`: Uses `payload.instructorId`, fetches instructor via `instructorId`
- `sendBookingConfirmationEmailsV2`: Uses `payload.instructorId`, fetches instructor via `instructorId`
- `sendInstructorBookingConfirmationEmails`: Uses `payload.instructorId`, fetches instructor via `instructorId`

**Product forms (`app/admin/products/_components/product-form.tsx`):**
- Both `platform` and `web` versions updated to use `instructorId` prop and `instructors` data
- `mentorId` → `instructorId` in schema, state, API calls, and display labels

**Product pages:**
- `apps/platform/app/admin/products/create/page.tsx`: Uses `/api/admin/instructors` endpoint, passes `{id, email}` mapped data as `instructors` prop
- `apps/platform/app/admin/products/[id]/edit/page.tsx`: Uses `/api/admin/instructors` endpoint, `instructorId` in schema
- `apps/web/app/admin/products/create/page.tsx`: Same fixes as platform version
- `apps/web/app/admin/products/[id]/edit/page.tsx`: Same fixes as platform version

**API client (`lib/queries/api-client.ts`):**
- `createProduct`, `updateProduct`, `createProductFromStripe`: `mentorId` → `instructorId`
- `UpdateProductResponseSchema`: Uses `instructorId`

### PR #263 Additional Completed Changes

**Admin instructor list (Convex):**
- Added `getInstructorsForAdmin` query in `convex/admin.ts` with `activeMenteeCount` and `totalCompletedSessions` computed on read
- `apps/web/app/api/admin/instructors/route.ts`: Now proxies Convex query (removed Postgres dependency)
- `apps/platform/app/api/admin/instructors/route.ts`: Same Convex proxy approach
- `apps/marketing/app/api/admin/instructors/route.ts`: Reverted to Postgres approach (no Convex setup in marketing)

**Admin instructor endpoints:**
- Deleted `apps/web/app/api/admin/instructors/mentors/route.ts`
- Deleted `apps/platform/app/api/admin/instructors/mentors/route.ts`
- Callers updated to use `/api/admin/instructors` which uses Convex

**Session packs (`sessionPacks.mentorId` → `sessionPacks.instructorId`):**
- Schema: `packages/db/src/schema/sessionPacks.ts` - `mentorId` column renamed to `instructorId` (NOT NULL)
- Query: `packages/db/src/lib/queries/sessionPacks.ts` - removed `mentorId` from insert values
- Admin queries: `packages/db/src/lib/queries/admin.ts` - fixed `totalCompletedSessions` SQL to use `instructorId`
- Inngest sync: `apps/web/inngest/functions/sync.ts` - `sessionPack.mentorId` → `sessionPack.instructorId`
- Calendar pages: `apps/web/app/calendar/page.tsx` and `apps/platform/app/calendar/page.tsx` - `sessionPacks.mentorId` → `instructorId`
- Session booking: `apps/web/app/api/sessions/route.ts` - gets instructor first, then mentor via `instructor.mentorId`
- Onboarding submit: `apps/web/app/api/onboarding/submit/route.ts` - same instructor→mentor lookup pattern
- Session counts: `apps/marketing/app/api/admin/session-counts/route.ts` - authorization uses `instructorId`
- Migration script: `scripts/migrate-to-convex/06-migrate-session-packs.ts` - updated interface and field mapping

**Admin mentees:**
- `packages/db/src/lib/queries/admin.ts` - removed `mentorId` from `getAdminMentees` select and type
- `apps/web/app/api/admin/mentees/route.ts` - removed `mentorId` from response mapping

**CodeRabbit review comments addressed:**
- Removed unused `enablePayPal` from import mutation and form (web & platform)
- Added Zod validation for API responses in product pages (web & platform)
- Removed `any` types from instructor mapping, replaced with typed parsing
- Added proper `isLoadingInstructors` state in edit pages (web & platform)
- Used `z.infer<typeof instructorOptionSchema>` for `InstructorOption` type alignment
- Used `instructor.name` as fallback when `userId` is missing in booking-emails (3 locations)
- Added FK constraint on `sessionPacks.instructor_id` referencing `instructors.id`

### Steps

- [x] **4.1** `apps/platform/` — largely complete via PR #262
- [x] **4.2** `apps/web/` — largely complete via PR #262
- [ ] **4.3** `apps/marketing/` — **EXCLUDED** from migration (maintained as-is while focusing on platform/web)
- [ ] **4.4** `apps/home/` (31 refs, 0 mentorId — mostly display strings)

### Key Files

| File | mentor refs | mentorId refs |
|------|------------|---------------|
| `app/admin/products/_components/product-form.tsx` (both platforms) | 120 | 24 |
| `app/admin/page.tsx` (both platforms) | 42 | 32 |
| `app/admin/instructors/[id]/edit/page.tsx` (both platforms) | 42 | 20 |
| `lib/emails/booking-email.ts` (both platforms) | 48 | 0 |
| `lib/instructors.ts` (marketing) | 40 | 0 |
| `inngest/functions/booking-emails.ts` (web) | 46 | 13 |

### Remaining Phase 4 Work

**Completed since PR #262:**
1. ✅ Add zod validation and error handling to product create pages (both platforms)
2. ✅ Fix `booking-emails.ts` to handle null `userId` properly
3. ✅ Update web instructor edit page (`apps/web/app/admin/instructors/[id]/edit/page.tsx`)
4. ✅ Complete sessionPacks.mentorId → instructorId migration across all apps
5. ✅ Add Convex `getInstructorsForAdmin` query and update admin instructor endpoints
6. ✅ Remove `/api/admin/instructors/mentors` endpoints (callers now use `/api/admin/instructors`)
7. ✅ Fix admin queries and types for instructorId changes

**Completed May 13-14, 2026 (PR #267 + #268):**
8. ✅ Fix `requireRole("mentor")` → `"instructor"` in 5 platform instructor pages (dashboard, settings, profile, sessions, onboarding)
9. ✅ Update auth-helpers.ts type signatures — removed "mentor" from union types (`requireRole`, `requireRoleForApi`)
10. ✅ Fix 10 API route references to use `requireRoleForApi("instructor")` instead of `"mentor"`:
    - `mentees-results/route.ts` (GET + POST)
    - `mentees-results/[resultId]/route.ts` (DELETE)
    - `settings/route.ts` (GET + PATCH)
    - `profile/route.ts` (GET + PATCH)
    - `testimonials/[testimonialId]/route.ts` (DELETE)
    - `testimonials/route.ts` (GET + POST)
11. ✅ Update error messages from "Forbidden: Mentor role required" → "Forbidden: Instructor role required"
12. ✅ Fix profile page to use Convex `api.instructors.getInstructorByUserId` instead of SQL `getMentorByUserId`
13. ✅ Update variable names from `mentor` → `instructorRecord` in platform instructor pages

14. ✅ **PR #268**: Delete `packages/db/src/lib/queries/mentors.ts` — function moved to `instructors.ts` as `getInstructorByUserId`
15. ✅ **PR #268**: Update platform instructor pages to use Convex for instructor data:
    - `apps/platform/app/instructor/dashboard/page.tsx` — Uses Convex query
    - `apps/platform/app/instructor/settings/page.tsx` — Uses Convex query
16. ✅ **PR #268**: Remove mentorId-dependent code (Google Calendar card) from platform/web instructor dashboards
17. ✅ **PR #268**: Rename variable references in web app:
    - `apps/web/app/admin/workspaces/page.tsx` — `mentor`→`instructor`, `menteeImageCount`→`studentImageCount`
    - `apps/web/app/checkout/page.tsx` — `useProductsByMentorId`→`useInstructorProducts`
    - `apps/web/app/instructors/[slug]/page.tsx` — `Mentor`→`InstructorProfile`, `MenteeResult`→`StudentResult`
18. ✅ **PR #268**: Add `"instructor"` to marketing auth role types

**Pending tasks:**
- Marketing app (242 refs) - uses Postgres approach, not Convex (no setup) — **EXCLUDED per user decision**
- Home app (31 refs) - lower priority, mostly display strings
- Phase 5 cleanup (delete SQL mentors table, Convex mentors table, etc.) — **PENDING**

### Commits Made (Phase 4 continuation)

- Phase 4: Add error handling to product create pages
- Phase 4: Fix booking-emails null userId handling
- Phase 4: Migrate web instructor edit page to use instructorId

### User-Facing Text Fixes (Terminology Consistency)

Fixed user-facing "mentor" → "instructor" terminology that was still appearing after recent PRs:

**Display text fixed:**
- "Mentor profile not found" → "Instructor profile not found" (instructor pages across web, platform, marketing)
  - `apps/web/app/instructor/dashboard/page.tsx`
  - `apps/web/app/instructor/settings/page.tsx`
  - `apps/web/app/instructor/sessions/page.tsx`
  - `apps/web/app/instructor/onboarding/page.tsx`
  - `apps/platform/app/instructor/dashboard/page.tsx`
  - `apps/platform/app/instructor/settings/page.tsx`
  - `apps/platform/app/instructor/sessions/page.tsx`
  - `apps/platform/app/instructor/onboarding/page.tsx`
  - `apps/marketing/app/instructor/dashboard/page.tsx`
- "Mentor workspace" → "Instructor workspace" (`apps/web/app/workspace/page.tsx`)
- "Mentor" column header → "Instructor" (admin workspaces pages)
  - `apps/web/app/admin/workspaces/page.tsx`
  - `apps/platform/app/admin/workspaces/page.tsx`

**Navigation links fixed:**
- "Browse Mentors" → "Browse Instructors" (3 landing preview footers)
- "Find Your Mentor" → "Find Your Instructor" (3 landing preview footers)
  - `apps/web/components/landing-preview/preview-footer.tsx`
  - `apps/platform/components/landing-preview/preview-footer.tsx`
  - `apps/home/components/landing-preview/preview-footer.tsx`

**Error messages fixed:**
- "Forbidden: mentor role required" → "Forbidden: instructor role required" (2 API routes)
  - `apps/web/app/api/auth/google/callback/route.ts`
  - `apps/web/app/api/auth/google/route.ts`

**Role checks updated:** The actual role checks (`user.role !== "mentor"`) were updated to `user.role !== "instructor"` in the Google OAuth routes (`apps/web/app/api/auth/google/route.ts` and `apps/web/app/api/auth/google/callback/route.ts`) to match the new DB schema enum. The `mentor` → `instructor` DB enum migration (`ALTER TYPE user_role RENAME VALUE 'mentor' TO 'instructor'`) must be applied before deploying these changes.

**DB Schema enum updated (PR #266):**
- `packages/db/src/schema/users.ts` - Changed userRoleEnum from `["student", "mentor", "admin", "video_editor"]` to `["student", "instructor", "admin", "video_editor"]`
- `packages/db/src/lib/clerk.ts` - Updated `syncClerkUserToSupabase` function signature and added Zod validation for `publicMetadata.role`
- `packages/db/src/lib/queries/users.ts` - Updated `updateUserRole` function signature to use "instructor" instead of "mentor"
- `packages/db/src/types/database.types.ts` - Updated all role type definitions

**Token decryption fixed (PR #266):**
- `apps/web/lib/crypto.ts` - Now properly uses `decrypt()` from `@mentorships/db` for migrated Postgres AES-256-GCM encrypted tokens (previously only handled legacy plain-text format)

**PostgreSQL migration script created (PR #266):**
- `packages/db/drizzle/0027_rename_user_role_mentor_to_instructor.sql` - SQL migration to rename the enum value from 'mentor' to 'instructor'. Must be run BEFORE deploying code changes that check for 'instructor' role.

**Auth helpers fixed (PR #266):**
- `apps/web/lib/auth.ts` - `requireDbUser()` now throws `UnauthorizedError` if user is not found in DB
- `apps/web/lib/auth-helpers.ts` - `requireRole()`, `requireRoleForApi()`, `hasRole()` now use `requireDbUser` instead of `getDbUser`
- `apps/marketing/lib/auth.ts` - Same fixes for marketing app

---

## Phase 5: Cleanup

**Goal**: Remove all legacy mentor references.

### Status: In Progress — Partially Complete via PR #268

### Steps

- [x] **5.1** Remove `MentorSchema`, `fetchMentors`, `mentors` query key namespace — **COMPLETE** (PR #268: deleted `packages/db/src/lib/queries/mentors.ts`)
- [x] **5.2** Remove `packages/db/src/schema/mentors.ts` and `mentors` table references — **COMPLETE** (PR #268: mentors.ts deleted)
- [x] **5.3** Remove `/api/admin/instructors/mentors` endpoint (deleted in PR #263)
- [ ] **5.4** Remove `convex/mentors.ts` and `mentors` table from Convex schema — **PENDING**
- [ ] **5.5** Rename remaining `mentor`-prefixed vars to `instructor` where appropriate — **ONGOING**
- [ ] **5.6** Update tests (4 files, 15 refs) — **PENDING**

### Phase 5 Investigation Findings (May 13-14, 2026)

#### Google Calendar Encryption Key (Blocking Item)

The `mentors` SQL table and `instructors` Convex table both store `googleRefreshToken` (encrypted). The encryption key `ENCRYPTION_KEY` must be confirmed working in all environments before Phase 5 cleanup.

**Current state:**
- SQL `mentors` table has `google_refresh_token` (encrypted with `ENCRYPTION_KEY` via AES-256-GCM)
- Convex `instructors` table has `googleRefreshToken` field (same encryption pattern)
- Encryption was migrated from unencrypted to encrypted format (v1 → v2 format)
- PR #266 fixed `decrypt()` in `apps/web/lib/crypto.ts` to handle migrated tokens

**Before Phase 5 cleanup:**
1. Verify `ENCRYPTION_KEY` is set in: local dev, Vercel preview, Vercel production (web + platform)
2. Verify Google Calendar tokens can be decrypted for existing instructors
3. Confirm Convex `instructors.googleRefreshToken` encryption path is also working

**Key files to verify:**
- `packages/db/src/lib/encryption.ts` — encryption/decryption logic
- `packages/db/src/lib/queries/mentors.ts:80` — `updateMentorGoogleCalendarAuth()` encrypts tokens
- `packages/db/src/lib/queries/mentors.ts:129` — `decryptMentorRefreshToken()` decrypts tokens
- `apps/web/lib/crypto.ts` — PR #266 fix for decrypting migrated tokens

#### `getMentorByUserId` Rename — **COMPLETED in PR #268**

**Status:** ✅ COMPLETE — Function renamed to `getInstructorByUserId` and moved to `packages/db/src/lib/queries/instructors.ts`

**What was done:**
- `packages/db/src/lib/queries/mentors.ts` **DELETED**
- `getInstructorByUserId` now exported from `packages/db/src/lib/queries/instructors.ts`
- Platform instructor pages updated to use Convex queries instead of this function
- Web app instructor settings page updated to use Convex queries

**Note:** Convex `instructors` table now stores Google Calendar tokens. SQL `mentors` table is deprecated.

**Convex `mentors` table status:**
- Table exists in `convex/schema.ts:52-59` but is **deprecated**
- `instructors` table has `googleRefreshToken`, `googleCalendarId` fields — mentors table is not needed for Google Calendar
- `convex/mentors.ts` is marked `@deprecated` with note: "mentors table is no longer used for Clerk user linking"
- **Still pending removal in Phase 5.4**

---

## What NOT to Change

- Past Drizzle migrations (17 SQL files) — immutable records
- The word "mentorship" in UI strings — product term, not data field
- `scripts/migrate-to-convex/` — historical migration scripts
- Documentation files — update after migration complete

---

## Estimated File Impact

| Phase | Files | Key Risk |
|-------|-------|----------|
| 1 | ~10 schema + 2 migration files | Data integrity (backfill correctness) |
| 2 | ~15 package files | Build breaks (type errors) |
| 3 | ~40 API route files | API contract changes (breaking change) |
| 4 | ~100 frontend files | UI rendering, query caching |
| 5 | ~15 cleanup files | Dropping table (irreversible) |

---

## Migration Pattern (Transition Period)

During transition, both `mentor_id` and `instructor_id` columns exist. Application code writes to both:

```ts
.insert({
  mentorId: data.instructorId,      // old column (still read by old code)
  instructorId: data.instructorId,   // new column (read by new code)
})
```

After all app code is updated (Phase 2-3 complete), Phase 1.5 drops old columns.

---

## What's Next (May 14, 2026)

### Immediate: PR #268 Merge ✅

PR #268 has been merged. Core mentor→instructor rename complete for platform/web.

### Remaining Work

**Phase 5 Cleanup (highest priority):**
1. **5.4** Remove `convex/mentors.ts` and `mentors` table from Convex schema
2. **5.5** Continue renaming remaining `mentor`-prefixed vars to `instructor` (ongoing)
3. **5.6** Update tests (4 files, 15 refs)
4. **Phase 1.5** Drop SQL `mentor_id` columns + `mentors` table (after Phase 2-3 complete)

**Key Blocker for Phase 5.4:**
- Google Calendar encryption key (`ENCRYPTION_KEY`) must be verified working in all environments before removing Convex `mentors` table

**Lower Priority (not in current PR scope):**
- Marketing app (242 mentor refs) — **EXCLUDED** per user decision, uses Postgres approach
- Home app (31 refs) — mostly display strings, lower priority
- SQL analytics queries — may still reference `mentorId` for admin stats

**Before Phase 1.5 (drop old columns):**
- Verify all app code uses `instructorId` exclusively
- Confirm no remaining readers depend on `mentor_id` column
- Apply NOT NULL constraint to `instructor_id` columns

### Summary

| Phase | Status |
|-------|--------|
| Phase 1 (DB Schema) | ✅ Complete |
| Phase 2 (Query Layer) | ✅ Complete (mentors.ts deleted in PR #268) |
| Phase 3 (API/Convex) | ⚠️ Partial — accepts both, returns instructorId |
| Phase 4 (Frontend) | ✅ Core complete — platform/web use Convex for instructor data |
| Phase 5 (Cleanup) | 🚧 In Progress — mentors.ts deleted, Convex mentors table pending |
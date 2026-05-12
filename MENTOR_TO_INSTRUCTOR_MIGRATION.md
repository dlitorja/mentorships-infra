# mentor → instructor Migration Plan

## Overview

**Goal**: Eliminate all instances of `mentor`/`mentorId` in favor of `instructor`/`instructorId` across all apps/platforms.

**Scope**: ~2,500 references across ~280 files

**Current State**:
- Convex: `mentorId` removed from most tables, `instructorId` used instead. `mentors` table still exists but is largely unused.
- Postgres/Drizzle: **Phase 1 complete** — `instructor_id` columns added and backfilled across 6 tables. Columns are nullable (NOT NULL enforcement deferred to before Phase 1.5). Both `mentor_id` and `instructor_id` columns exist. `mentors` table still exists.
- API layer: Still returns `mentorId` in responses, accepts it in request bodies.
- Frontend: ~1,500 refs across `platform`, `web`, `marketing`, `home` apps.

---

## Key Challenges

1. `instructors.mentorId` is a FK bridge to `mentors.id` — must be replaced with direct `instructors.id` reference.
2. Inconsistent column types: `mentor_id` is `text` in some tables, `uuid` in others.
3. No shared canonical type — `mentorId` is redefined as `string` at every layer.
4. Two live frontends (`platform` + `web`) + `marketing` — changes must be coordinated.
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
- [ ] **2.3** Migrate `mentors.ts` query functions to `instructors.ts` — pending (mentors table still in use for mentor-specific fields like Google Calendar auth)
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

### PR #259 Status
- Core issues flagged by greptile are **resolved** and **committed**
- Vercel platforms & web deployments: **still pending** (CI must confirm)
- greptile review decision still shows `CHANGES_REQUESTED` — will update once CI passes

---

## Phase 3: API & Convex Layer

**Goal**: Update API contracts from `mentorId` → `instructorId`.

### Status: Next (planned)

### Steps

- [ ] **3.1** Convex `http.ts`: Rename `mentorId` params → `instructorId` (add backward compat)
- [ ] **3.2** Platform API routes (~36 files)
- [ ] **3.3** Web API routes (~36 files)
- [ ] **3.4** Marketing API routes (~5 files)
- [ ] **3.5** Merge/remove `convex/mentors.ts`

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

### Status: Pending

### Steps

- [ ] **4.1** `apps/platform/` (517 refs, 71 mentorId)
- [ ] **4.2** `apps/web/` (741 refs, 85 mentorId)
- [ ] **4.3** `apps/marketing/` (242 refs, 12 mentorId)
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

---

## Phase 5: Cleanup

**Goal**: Remove all legacy mentor references.

### Status: Pending

### Steps

- [ ] **5.1** Remove `MentorSchema`, `fetchMentors`, `mentors` query key namespace
- [ ] **5.2** Remove `packages/db/src/schema/mentors.ts` and `mentors` table references
- [ ] **5.3** Remove `/api/admin/instructors/mentors` endpoint
- [ ] **5.4** Remove `convex/mentors.ts` and `mentors` table from Convex schema
- [ ] **5.5** Rename remaining `mentor`-prefixed vars to `instructor` where appropriate
- [ ] **5.6** Update tests (4 files, 15 refs)

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
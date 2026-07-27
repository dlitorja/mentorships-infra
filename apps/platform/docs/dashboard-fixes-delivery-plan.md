# Dashboard Fixes Delivery Plan

Tracking the rollout of fixes identified in the `apps/platform` admin, instructor, and student dashboard review.

## Bundling strategy

Fixes are grouped into the smallest number of PRs that still share a single theme and can be verified end-to-end. Each PR should be reviewed with Greptile once, then deployed and verified before the next one is opened.

| PR | Theme | Why bundled | Status | Risk |
|---|---|---|---|---|
| **1** | Convex auth tokens for instructor & student routes | Same pattern, same blocker, huge blast radius | Merged | P0 — most instructor/student features are broken without this |
| **2** | Instructor self-service: profile, images, onboarding review | All fix instructor-owned record mutations/UI | Merged | P0 — profile editing and onboarding are non-functional |
| **3** | Student booking navigation & calendar ID mismatch | Both break the student booking → workspace flow | Merged | P0 — links go to wrong IDs and calendar uses wrong ID types |
| **4** | Session actions, notifications, and email preview | All fix how sessions are cancelled/rescheduled/notified | Merged | P1 — notifications and calendar cleanup are skipped |
| **5** | Data refresh & booking reliability | React Query invalidation, DST bug, orphaned calendar events | Merged | P1 — UI stays stale and booking edge cases are unreliable |
| **6** | Security & API hardening | Public API leaks, waitlist auth, empty `catch` lint errors plus remaining lint errors | In review | P1 — security and lint failures |
| **7** | Admin dashboard & code quality | Naming, unused code, `<img>` tags, console noise, alerts | Not started | P2 — cleanup and convention compliance |

---

## PR 1: Convex auth tokens

**Goal:** every server page and API route that talks to Convex on behalf of a user must authenticate the `ConvexHttpClient` with the Clerk token.

### Scope
- Instructor server pages: `app/instructor/sessions/page.tsx`, `app/instructor/availability/page.tsx`, `app/instructor/settings/page.tsx`, `app/instructor/onboarding/page.tsx`, `app/instructor/profile/page.tsx`.
- `components/navigation/protected-layout.tsx` (so the correct nav is rendered).
- Instructor API routes: `app/api/instructor/*`, `app/api/sessions/[sessionId]/reschedule|cancel|notes`, `app/api/bookings/*`.
- Student API routes: `app/api/bookings/*`, `app/api/sessions/*`, `app/api/user/settings/route.ts`.

### Pattern to follow
Use `getAuthenticatedConvexClient()` from `lib/convex.ts`. The helper:
1. Fetches the Clerk "convex" JWT via `getConvexAuthToken()`.
2. Creates a `ConvexHttpClient` and calls `client.setAuth(token)`.
3. Throws a typed `UnauthorizedError` when no token is available so callers can return 401 or render a graceful fallback.

API routes should wrap the call in a `try/catch` and check `isUnauthorizedError(error)` (and `isForbiddenError(error)` where the route also calls `requireRoleForApi`). Server pages should call `getConvexAuthToken()` first and render a fallback UI when the token is missing, then call `getAuthenticatedConvexClient()` for the actual data fetch.

### Verification
- [x] Instructor dashboard loads instructor record and shows instructor nav.
- [x] Instructor settings, availability, profile, and onboarding pages load data.
- [x] Student bookings endpoint `/api/bookings/me` returns real data.
- [x] Session cancel/reschedule/notes endpoints work without `Unauthorized`.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` reports no new issues (165 pre-existing issues remain).
- [x] Greptile review passed at 5/5 confidence.

### Improvements applied during PR 1
- Centralized token acquisition in a single `getAuthenticatedConvexClient()` helper instead of duplicating `getConvexAuthToken()` + `setAuth()` in every route/page.
- Standardized API error handling on `isUnauthorizedError` / `isForbiddenError` so every route returns a deterministic 401/403 rather than a 500.
- Added graceful "Authentication required" fallbacks to all server pages instead of letting `UnauthorizedError` surface as an unhandled error.
- Removed one forbidden `mentee` reference in `app/api/instructor/students/route.ts` while the file was already being edited.

---

## PR 2: Instructor self-service

**Goal:** make the instructor profile page and onboarding review actually functional.

### Scope
- `convex/instructors.ts` — add self-service `updateInstructorProfile` mutation with a `userId` ownership check.
- `convex/instructors.ts` — add `addInstructorProfileImage`, `addInstructorPortfolioImage`, and `generateAuthenticatedInstructorUploadUrl` for authenticated, instructor-owned image uploads.
- `app/api/instructor/profile/route.ts` — switch to `updateInstructorProfile`.
- `app/api/instructor/upload-image/route.ts` — new POST handler for profile/portfolio images with file-type and size validation.
- `app/api/instructor/onboarding/review/route.ts` — new POST handler that calls `studentOnboarding.markReviewed`.
- `app/instructor/profile/profile-form.tsx` — switch image uploads to the new API endpoints and replace forbidden "Mentee" wording with "Student".
- `convex/schema.ts` — add `by_legacyId` index on `studentOnboardingSubmissions`.
- `convex/studentOnboarding.ts` — use `withIndex("by_legacyId")` for `getByLegacyId` and `markReviewed`.

### Verification
- [ ] Instructor can edit and save profile fields; values persist after refresh.
- [ ] Instructor can upload profile and portfolio images.
- [ ] “Mark reviewed” onboarding action succeeds without 404.
- [x] `npm run lint` reports no new issues (165 pre-existing issues remain).
- [x] `npm run typecheck` passes.
- [x] Greptile review passed at 5/5 confidence.
- [ ] End-to-end functional verification pending deployment.

---

## PR 3: Student booking navigation & calendar ID mismatch

**Goal:** student dashboard and session list links must go to real workspace IDs, and the calendar booking flow must use Convex IDs.

### Scope
- `app/dashboard/DashboardContent.tsx` — change workspace links from session-pack IDs to workspace IDs.
- `app/sessions/SessionsContent.tsx` — fix the `sessionPackId`/`packId` field and workspace link.
- `lib/queries/convex/use-session-packs.ts` — implement `useWorkspaceBySessionPack` or resolve workspace IDs in the parent query.
- `app/calendar/page.tsx` and `components/calendar/book-session-form.tsx` — stop passing Postgres UUIDs to Convex APIs; either map to Convex IDs or migrate the calendar page to Convex session packs.

### Verification
- [x] Dashboard “Workspace” links open the correct workspace.
- [x] Sessions list workspace links open the correct workspace.
- [x] Calendar booking flow creates a session with a valid instructor/session pack.
- [x] `npm run lint` and `npm run typecheck` pass.
- [x] Greptile review has no new issues.

### Improvements applied during PR 3
- Migrated `app/calendar/page.tsx` from Postgres/Drizzle queries to authenticated Convex `fetchQuery`, removing the ID-mismatch risk entirely.
- Added `resolveActiveWorkspaceForPair` resolution to `getUserActiveSessionPacks`, `getUpcomingSessions`, `getUpcomingSessionsWithInstructor`, and `getAllStudentSessionsWithInstructor` so every student-facing session/pack row carries its real workspace ID.
- Added ownership guards (`user.subject === args.studentId/userId`) to student-scoped queries to prevent cross-user reads.
- Replaced string casts with proper `Id<"sessionPacks">` / `Id<"instructors">` types in the booking components.
- Added `linkWorkspacesByEmail` and `/internal/link-workspaces` so guest-checkout workspaces have their `ownerId` updated from an email placeholder to the real Clerk ID during account linking.

---

## PR 4: Session actions, notifications, and email preview

**Goal:** session reschedule/cancel/notes go through the API routes that send notifications and clean up calendar events.

### Scope
- `components/instructor/session-actions.tsx` and `components/instructor/student-detail-session-actions.tsx` — replace direct `useMutation(api.sessions.*)` calls with calls to `/api/sessions/[sessionId]/reschedule|cancel|notes`.
- Consolidate the two action components if possible.
- `app/api/sessions/[sessionId]/reschedule/route.ts` and `cancel/route.ts` — replace the admin-only `api.users.getUserByUserId` call with an instructor-accessible lookup.
- `app/api/instructor/sessions/[sessionId]/email-preview/route.ts` — fix the user lookup to use `userId` (Clerk string) rather than a Convex document ID.

### Verification
- [x] Rescheduling a session sends the notification and updates the calendar.
- [x] Cancelling a session sends the notification and removes the calendar event.
- [x] Email preview endpoint returns a preview for the correct student.
- [x] `npm run lint` and `npm run typecheck` pass.
- [x] Greptile review has no new issues.

### Improvements applied during PR 4
- Migrated `components/instructor/session-actions.tsx` from direct `useMutation(api.sessions.*)` calls to the authenticated `/api/sessions/[sessionId]/reschedule|cancel|notes` REST routes so notifications and UI refresh are handled server-side.
- Switched the reschedule/cancel routes from the admin-only `api.users.getUserByUserId` to the authenticated `api.users.getUserByClerkIdPublic`, unblocking student email lookup for instructor-initiated changes.
- Fixed the email-preview route to look up the student by the Clerk `userId` string stored on `session.studentId` instead of casting it to a Convex document ID.
- Removed the unused `PreviewType` type from the email-preview route.

---

## PR 5: Data refresh & booking reliability

**Goal:** mutations correctly invalidate Convex React Query keys and booking edge cases are reliable.

### Scope
- `lib/queries/convex/use-sessions.ts`, `use-session-packs.ts`, `use-instructors.ts`, `use-products.ts` — update `queryClient.invalidateQueries` to use the `@convex-dev/react-query` key shape (`["convexQuery", ...]`). Follow the pattern already used in `components/video/video-call-provider.tsx`.
- `app/api/bookings/series/route.ts` — compute recurring slots in the instructor/student time zone instead of adding UTC milliseconds.
- `app/api/bookings/route.ts` — delete the Google Calendar event if the Convex `confirm` mutation fails after the calendar event was created.

### Verification
- [x] After booking/cancelling/rescheduling, dashboard and sessions lists refresh automatically.
- [x] Recurring weekly series preserves the same local time across DST boundaries.
- [x] Failed booking confirmation does not leave an orphan event on the instructor’s Google Calendar.
- [x] `npm run lint` and `npm run typecheck` pass.
- [x] Greptile review has no new issues.

### Improvements applied during PR 5
- Migrated `use-mutations.ts` in addition to the originally planned hooks because it exported the same broken invalidation keys.
- Added `lib/timezone.ts` with unit tests so the DST-safe arithmetic is isolated and verifiable, rather than inline in the booking route.
- Normalized `addDays`/`addMinutes` to valid calendar components so the `localDateTimeToUtcMillis` brute-force search is the real code path, not a silent fallback.
- Noted and fixed that `useCompleteSession` in `use-sessions.ts` omitted `sessionPacks:` invalidation compared to the parallel hook in `use-mutations.ts`.

---

## PR 6: Security & API hardening

**Goal:** close API leaks and fix all current lint errors so `npm run lint` reaches zero errors.

### Branch
`fix/security-api-hardening`

### Security fixes

#### 1. Close public product API leaks
Payment-provider IDs (`stripePriceId`, `paypalProductId`) are sensitive and should never be returned by public endpoints.

- `app/api/products/route.ts`
  - Remove `stripePriceId` and `paypalProductId` from the mapped response.
  - Optionally add public booleans (`hasStripePayment`, `hasPayPalPayment`) if the UI needs to show available payment methods, but the endpoint is currently unused.
- `app/api/products/[id]/route.ts`
  - Already gated by `requireAuth()`; remove `stripePriceId` from the response as well.
- `app/api/products/by-stripe-price/route.ts`
  - This endpoint is intended for payment-provider webhooks; confirm it is not public and document why it needs the raw ID.
- `app/lib/queries/api-client.ts`
  - Update `fetchProduct` and `fetchProducts` response types to drop the payment-provider IDs.
  - Note: `fetchProducts` and `fetchProduct` are unused in the app; consider deprecating them, but keep minimal changes.

#### 2. Require authentication for waitlist lookup
- `app/api/waitlist/route.ts`
  - `GET`: add `requireAuth()` / `auth()` check.
  - Derive the email from the Clerk session instead of accepting it from query params.
  - Return 401 for unauthenticated requests.
  - Keep the existing POST flow public (anyone can join a waitlist), but harden the GET lookup to self-only.
- `app/lib/queries/api-client.ts`
  - Update `fetchWaitlistStatus` type if needed; the function is currently unused.

#### 3. Authenticate the user-settings Convex call
- `app/api/user/settings/route.ts`
  - Already authenticates via Clerk; no change needed unless the route leaks the Convex user ID.
- `convex/users.ts`
  - Add `ctx.auth.getUserIdentity()` to the `updateUser` mutation.
  - Look up the authenticated user's record by email / subject.
  - Only allow the mutation if `args.id` matches the authenticated user's own document `_id`.
  - Throw `Unauthorized` for cross-user updates.
  - This also hardens the exposed `useUpdateUser` hooks in `lib/queries/convex/use-users.ts` and `lib/queries/convex/use-mutations.ts` (both currently unused but public).

### Lint fixes (all current errors)

Current `npm run lint` reports **13 errors**. The PR must close all of them.

#### Empty `catch` blocks in checkout/booking routes
- `app/api/checkout/stripe/route.ts` (4 errors, lines 93, 148, 160, 290)
  - Remove the inner `try { console.error(...) } catch {}` wrappers.
  - Log the Clerk error details directly; `console.error` failing in Next.js is not a realistic failure mode.
- `app/api/checkout/paypal/route.ts` (3 errors, lines 76, 119, 130)
  - Same pattern as Stripe route.
- `app/api/bookings/notify/route.ts` (1 error, line 41)
  - Replace `catch {}` with `catch (err) { console.error("Failed to check admin role for notify", err); }` or similar.
- `components/calendar/book-with-google.tsx` (1 error, line 115)
  - Replace empty catch with a `console.error` log (or `reportError` if available) and keep the fallback behavior.

#### Remaining lint errors required for zero
- `app/instructor/students/page.tsx` (3 errors)
  - Move `filteredAndSortedStudents = useMemo(...)` before the `isLoading` and `error` early returns so the hook is always called in the same order.
  - Wrap the `case "lastSession":` block in braces to fix `no-case-declarations` errors.
- `components/workspace/notes.tsx` (1 error, line 194)
  - Remove the `return` statement from the `finally` block of `flushAutosave`; restructure the conditional so the function does not return from `finally`.

### Verification
- [x] `GET /api/products` and `GET /api/products/[id]` no longer return `stripePriceId`/`paypalProductId`.
- [x] `GET /api/waitlist` returns 401 without a Clerk session and only returns the current user's own waitlist status.
- [x] `convex/users.updateUser` rejects cross-user updates with `Unauthorized` and no longer accepts `role`.
- [x] `npm run lint` reports **zero errors** (warnings remain acceptable).
- [x] `npm run typecheck` passes.
- [x] Greptile review has no new issues.
- [ ] `pnpm vitest run apps/platform/lib/timezone.test.ts` still passes (regression check).

### Risks and mitigations
- **Checkout page still needs payment method info**: The checkout page uses `useProductsByInstructorId`/`usePublicActiveProducts` (direct Convex queries), not the REST products API, so removing the IDs from the REST response does not affect checkout.
- **Waitlist GET self-lookup**: If the frontend later re-enables `fetchWaitlistStatus`, it must call the endpoint without an `email` query param.
- **updateUser auth**: If any internal/admin code calls `api.users.updateUser` for another user, it will break. We will verify no such callers exist; admin role changes should use `updateUserRole` instead.

---

## PR 7: Admin dashboard & code quality

**Goal:** clean up admin UI, fix naming conventions, and remove dead code.

### Scope
- `app/admin/workspaces/create/page.tsx` — replace forbidden word `mentee` in the comment.
- Admin pages: remove unused imports, `console.error`/`console.log`, `alert()` calls, and `as any` casts.
- Replace `<img>` with Next.js `<Image />` where appropriate.
- Fix `useEffect` missing dependencies in `app/admin/orders/page.tsx` and `app/admin/products/page.tsx`.
- Delete or move unused components (`components/instructor/session-cards.tsx`, `components/instructor/bookings-list.tsx`) if they are no longer needed.

### Verification
- [ ] No forbidden `mentor`/`mentee` words remain in changed files.
- [ ] `npm run lint` and `npm run typecheck` pass.
- [ ] Admin pages render without console warnings.
- [ ] Greptile review has no new issues.

---

## Cross-cutting reminders

- Follow the `widen-migrate-narrow` rule for any schema or mutation changes.
- Do not modify Clerk configuration or environment variables without explicit approval.
- Run Greptile locally before opening each PR and again after addressing any feedback.
- Keep each PR focused on the theme above; do not mix auth fixes with quality cleanup.
- When writing commit messages and PR bodies, never include secret values, API keys, or connection strings.

---

## Progress tracker

| PR | Branch | Status | Merged | Notes |
|---|---|---|---|---|
| 1 | `fix/dashboard-auth-tokens` | Merged | https://github.com/dlitorja/mentorships-infra/pull/685 | Blocker for most instructor/student functionality |
| 2 | `fix/instructor-self-service` | Merged | https://github.com/dlitorja/mentorships-infra/pull/686 | Depends on PR 1 |
| 3 | `fix/student-booking-navigation` | Merged | https://github.com/dlitorja/mentorships-infra/pull/687 | Depends on PR 1 |
| 4 | `fix/session-actions-notifications` | Merged | https://github.com/dlitorja/mentorships-infra/pull/688 | Depends on PR 1 |
| 5 | `fix/data-refresh-reliability` | Merged | https://github.com/dlitorja/mentorships-infra/pull/689 | Depends on PR 1 and 3 |
| 6 | `fix/security-api-hardening` | In review | https://github.com/dlitorja/mentorships-infra/pull/690 | Can be done in parallel after PR 1 |
| 7 | `fix/admin-quality-cleanup` | Not started | | Independent cleanup PR |

*Last updated: 2026-07-27 — PR 1, PR 2, PR 3, PR 4, PR 5 are merged; PR 6 (`fix/security-api-hardening`) is in review at https://github.com/dlitorja/mentorships-infra/pull/690.*

---

## Summaries for new sessions

The following one-paragraph summaries are meant to quickly orient a new agent (or a future session) to the remaining PRs.

### PR 4: Session actions, notifications, and email preview
Replace direct `useMutation(api.sessions.*)` calls in the instructor session-action components with calls to the authenticated `/api/sessions/[sessionId]/reschedule|cancel|notes` routes. Make the reschedule/cancel endpoints use an instructor-accessible user lookup instead of the admin-only one, and fix the email-preview endpoint so it looks up the student by Clerk `userId` rather than a Convex document ID.

### PR 5: Data refresh & booking reliability
Fix React Query invalidation so dashboards refresh after mutations (use the `@convex-dev/react-query` key shape). Fix recurring series booking so it preserves the same local time across DST changes, and make the booking confirmation endpoint delete the Google Calendar event if the Convex mutation fails, preventing orphaned calendar events.

### PR 6: Security & API hardening
Close public API leaks: remove `stripePriceId`/`paypalProductId` from the public products response, require authentication for waitlist lookup, and finish authenticating the user-settings endpoint. Replace empty `catch` blocks in checkout and booking routes with proper logging so `npm run lint` reports zero errors.

### PR 7: Admin dashboard & code quality
Admin-only cleanup: replace the forbidden `mentee` word in the workspace create page, remove unused imports, `console.log`/`alert()` calls, and `as any` casts, swap `<img>` for Next.js `<Image />`, and delete or move unused instructor components (`session-cards`, `bookings-list`).

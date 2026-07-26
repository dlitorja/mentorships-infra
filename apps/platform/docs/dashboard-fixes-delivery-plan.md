# Dashboard Fixes Delivery Plan

Tracking the rollout of fixes identified in the `apps/platform` admin, instructor, and student dashboard review.

## Bundling strategy

Fixes are grouped into the smallest number of PRs that still share a single theme and can be verified end-to-end. Each PR should be reviewed with Greptile once, then deployed and verified before the next one is opened.

| PR | Theme | Why bundled | Status | Risk |
|---|---|---|---|---|
| **1** | Convex auth tokens for instructor & student routes | Same pattern, same blocker, huge blast radius | Not started | P0 — most instructor/student features are broken without this |
| **2** | Instructor self-service: profile, images, onboarding review | All fix instructor-owned record mutations/UI | Not started | P0 — profile editing and onboarding are non-functional |
| **3** | Student booking navigation & calendar ID mismatch | Both break the student booking → workspace flow | Not started | P0 — links go to wrong IDs and calendar uses wrong ID types |
| **4** | Session actions, notifications, and email preview | All fix how sessions are cancelled/rescheduled/notified | Not started | P1 — notifications and calendar cleanup are skipped |
| **5** | Data refresh & booking reliability | React Query invalidation, DST bug, orphaned calendar events | Not started | P1 — UI stays stale and booking edge cases are unreliable |
| **6** | Security & API hardening | Public API leaks, waitlist auth, empty `catch` lint errors | Not started | P1 — security and lint failures |
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
Use `getConvexAuthToken()` from `lib/auth-helpers.ts` and `convex.setAuth(token)` before `fetchQuery`/`fetchMutation`. Example already exists in `app/api/instructor/session-packs/[sessionPackId]/route.ts`.

### Verification
- [ ] Instructor dashboard loads instructor record and shows instructor nav.
- [ ] Instructor settings, availability, profile, and onboarding pages load data.
- [ ] Student bookings endpoint `/api/bookings/me` returns real data.
- [ ] Session cancel/reschedule/notes endpoints work without `Unauthorized`.
- [ ] `npm run lint` and `npm run typecheck` pass.
- [ ] Greptile review has no new issues.

---

## PR 2: Instructor self-service

**Goal:** make the instructor profile page and onboarding review actually functional.

### Scope
- `app/api/instructor/profile/route.ts` — fix the `updateInstructor` call so non-admin instructors can update their own profile fields (name, bio, specialties, portfolio, etc.), or introduce an instructor-specific mutation.
- `app/instructor/profile/profile-form.tsx` and `components/admin/instructor-image-upload.tsx` — switch image upload to the dedicated `uploadInstructorProfileImage` / `uploadInstructorPortfolioImage` Convex mutations.
- `app/instructor/onboarding/page.tsx` — implement the missing `/api/instructor/onboarding/review` POST handler or change the form to use the correct existing endpoint.

### Verification
- [ ] Instructor can edit and save profile fields; values persist after refresh.
- [ ] Instructor can upload profile and portfolio images.
- [ ] “Mark reviewed” onboarding action succeeds without 404.
- [ ] `npm run lint` and `npm run typecheck` pass.
- [ ] Greptile review has no new issues.

---

## PR 3: Student booking navigation & calendar ID mismatch

**Goal:** student dashboard and session list links must go to real workspace IDs, and the calendar booking flow must use Convex IDs.

### Scope
- `app/dashboard/DashboardContent.tsx` — change workspace links from session-pack IDs to workspace IDs.
- `app/sessions/SessionsContent.tsx` — fix the `sessionPackId`/`packId` field and workspace link.
- `lib/queries/convex/use-session-packs.ts` — implement `useWorkspaceBySessionPack` or resolve workspace IDs in the parent query.
- `app/calendar/page.tsx` and `components/calendar/book-session-form.tsx` — stop passing Postgres UUIDs to Convex APIs; either map to Convex IDs or migrate the calendar page to Convex session packs.

### Verification
- [ ] Dashboard “Workspace” links open the correct workspace.
- [ ] Sessions list workspace links open the correct workspace.
- [ ] Calendar booking flow creates a session with a valid instructor/session pack.
- [ ] `npm run lint` and `npm run typecheck` pass.
- [ ] Greptile review has no new issues.

---

## PR 4: Session actions, notifications, and email preview

**Goal:** session reschedule/cancel/notes go through the API routes that send notifications and clean up calendar events.

### Scope
- `components/instructor/session-actions.tsx` and `components/instructor/student-detail-session-actions.tsx` — replace direct `useMutation(api.sessions.*)` calls with calls to `/api/sessions/[sessionId]/reschedule|cancel|notes`.
- Consolidate the two action components if possible.
- `app/api/sessions/[sessionId]/reschedule/route.ts` and `cancel/route.ts` — replace the admin-only `api.users.getUserByUserId` call with an instructor-accessible lookup.
- `app/api/instructor/sessions/[sessionId]/email-preview/route.ts` — fix the user lookup to use `userId` (Clerk string) rather than a Convex document ID.

### Verification
- [ ] Rescheduling a session sends the notification and updates the calendar.
- [ ] Cancelling a session sends the notification and removes the calendar event.
- [ ] Email preview endpoint returns a preview for the correct student.
- [ ] `npm run lint` and `npm run typecheck` pass.
- [ ] Greptile review has no new issues.

---

## PR 5: Data refresh & booking reliability

**Goal:** mutations correctly invalidate Convex React Query keys and booking edge cases are reliable.

### Scope
- `lib/queries/convex/use-sessions.ts`, `use-session-packs.ts`, `use-instructors.ts`, `use-products.ts` — update `queryClient.invalidateQueries` to use the `@convex-dev/react-query` key shape (`["convexQuery", ...]`). Follow the pattern already used in `components/video/video-call-provider.tsx`.
- `app/api/bookings/series/route.ts` — compute recurring slots in the instructor/student time zone instead of adding UTC milliseconds.
- `app/api/bookings/route.ts` — delete the Google Calendar event if the Convex `confirm` mutation fails after the calendar event was created.

### Verification
- [ ] After booking/cancelling/rescheduling, dashboard and sessions lists refresh automatically.
- [ ] Recurring weekly series preserves the same local time across DST boundaries.
- [ ] Failed booking confirmation does not leave an orphan event on the instructor’s Google Calendar.
- [ ] `npm run lint` and `npm run typecheck` pass.
- [ ] Greptile review has no new issues.

---

## PR 6: Security & API hardening

**Goal:** close API leaks and fix the lint errors caused by empty `catch` blocks.

### Scope
- `app/api/products/route.ts` — remove `stripePriceId`/`paypalProductId` from the public response or gate the endpoint behind auth.
- `app/api/waitlist/route.ts` — require authentication for waitlist membership lookup.
- `app/api/user/settings/route.ts` — ensure the Convex call is authenticated and scoped to the caller.
- `app/api/bookings/notify/route.ts`, `app/api/checkout/stripe/route.ts`, `app/api/checkout/paypal/route.ts`, `components/calendar/book-with-google.tsx` — replace empty `catch` blocks with proper logging/error handling.

### Verification
- [ ] Public product list no longer exposes payment provider IDs.
- [ ] Waitlist lookup requires authentication.
- [ ] `npm run lint` reports zero errors.
- [ ] `npm run typecheck` passes.
- [ ] Greptile review has no new issues.

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
| 1 | `fix/dashboard-auth-tokens` | Not started | | Blocker for most instructor/student functionality |
| 2 | `fix/instructor-self-service` | Not started | | Depends on PR 1 |
| 3 | `fix/student-booking-navigation` | Not started | | Depends on PR 1 |
| 4 | `fix/session-actions-notifications` | Not started | | Depends on PR 1 |
| 5 | `fix/data-refresh-reliability` | Not started | | Depends on PR 1 and 3 |
| 6 | `fix/security-api-hardening` | Not started | | Can be done in parallel after PR 1 |
| 7 | `fix/admin-quality-cleanup` | Not started | | Independent cleanup PR |

*Last updated: 2026-07-26*

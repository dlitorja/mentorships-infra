# apps/platform Refactoring & Improvement Plan

Generated: 2026-08-01

This document captures opportunities for refactoring, bug fixes, performance optimizations, and quality improvements in `apps/platform`. Items are grouped into **cohesive pull requests** to minimize the number of Greptile reviews and reduce review overhead.

## PR Status

| PR | Theme | Status |
|----|-------|--------|
| 1 | Security & architecture hardening | Merged (#710) |
| 2 | API / data layer consolidation | Merged (#712) |
| 3 | Session actions consolidation & reschedule correctness | Merged (#716) |
| 4 | Image upload consolidation & Next.js Image migration | Merged (#717) |
| 4.5 | Shared ImageUploadField / CropDialog in `@mentorships/ui` | Merged (#719) |
| 5 | Type safety & checkout UX | Merged (#720) |
| 6 | Testing infrastructure | Merged (#721) |
| 7 | Performance & loading states | Merged (#722) — see [`docs/plans/pr-7-performance-loading-states.md`](../../docs/plans/pr-7-performance-loading-states.md) |
| 8 | Accessibility, UI consistency, and cleanup | Merged (#723) |

## Completed PRs

### PR 1: Security & Architecture Hardening (#710)

**Status:** Squash-merged.

- Migrated onboarding images from Supabase to Convex Storage across `apps/web` and `apps/platform`.
- Added authentication and ownership checks to all Convex onboarding storage functions.
- Added upload record/verification to prevent arbitrary `storageId` submission.
- Added cleanup of partial uploads on batch failure.
- Added fetch timeout and Zod validation to the upload route.
- Sanitized email preview HTML with `sanitize-html`.
- Moved hardcoded admin emails to `ADMIN_EMAILS` env var.
- Fixed N+1 product lookup in admin instructors with `getProductsByInstructorIds`.
- Added `activeStudentCount` to instructor listing query and removed `as any` casts.
- Added concrete types for `imageObjects` and handled legacy Postgres entries.
- Added/expanded Convex tests.
- Greptile review returned 0 comments after addressing initial feedback.

### PR 2: API / Data Layer Consolidation (#712)

**Status:** Squash-merged.

- Standardized server-side Convex client initialization on `getAuthenticatedConvexClient()` / `getConvexClient()` from `lib/convex.ts`, removing 16+ local `getConvexClient()` factories and manual Clerk token boilerplate.
- Migrated all client-side direct `fetch()` calls for internal `/api/...` endpoints to typed `apiFetch` helpers or new helpers in `lib/queries/api-client.ts`.
- Centralized all API endpoint strings in `lib/routes.ts` and routed existing and new call sites through `ApiRoutes`.
- Replaced custom `convexQuery`/`convexMutation` wrappers in `inngest/functions/payments.ts` with `convexServerCall`, adding 15 matching HTTP actions in `convex/http.ts`.
- Fixed `api.users.syncUser` calls in admin upload/backfill/seed-role routes to pass valid `{}` arguments and removed unnecessary `as any` casts.

### PR 4: Image Upload Consolidation & Next.js Image Migration (#717)

**Status:** Squash-merged.

- Consolidated `admin-image-upload`, `instructor-image-upload`, and `image-upload-field` into a single `ImageUploadField` component in both `apps/platform` and `apps/web`.
- Added Zod runtime validation for upload responses, `onCommit` for URL inputs, and upload-path callbacks for profile and student-result images.
- Migrated image previews to Next.js `Image` with `unoptimized` for dynamic Convex Storage URLs.
- Added `images.remotePatterns` for `**.convex.cloud` in `apps/web/next.config.ts`.
- Removed committed `.bak` files from the source tree.

### PR 3: Session Actions Consolidation & Reschedule Correctness (#716)

**Status:** Squash-merged.

- Consolidated duplicate session-action dialogs and API call patterns.
- Fixed reschedule timezone handling in `datetime-local` inputs.
- Replaced async `useTransition` with explicit pending state in session actions.
- Surfaced errors from `EnsureInstructorRole` and fixed `EmailPreviewTab` race conditions.

### PR 5: Type Safety & Checkout UX (#720)

**Status:** Squash-merged.

- Removed widespread `as any` casts and added shared TypeScript interfaces (`InstructorDetail`, `Product`, `PublicInstructor`).
- Fixed `useForm` integration in availability and product forms.
- Moved checkout guest validation out of the mutation into form-level validation.
- Removed extra `paymentMethod` resets in `checkout/page.tsx`.

### PR 6: Testing Infrastructure (#721)

**Status:** Squash-merged.

- Added shared `tests/unit/test-utils.tsx` with TanStack Query provider and `renderWithProviders`.
- Added component tests for session actions, booking form, chat, image upload, and instructor creation.
- Added API route tests for auth sync, bookings, Stripe checkout, and session reschedule.
- Deferred full E2E Playwright flows to a follow-up PR requiring a seeded test backend.

### PR 7: Performance & Loading States (#722)

**Status:** Squash-merged.

- Added Suspense boundaries with error fallbacks to `/instructors`, `/instructor/dashboard`, `/admin`, and the landing testimonials.
- Removed `apps/platform/lib/instructors.ts` mock data and migrated the carousel to a new Convex public testimonial query.
- Replaced Google Calendar `sessionStorage` cache with user-scoped TanStack Query hooks and centralized invalidation.
- Converted `DashboardContent` manual Google fetches to the new hooks.
- Removed unnecessary `useMemo` for trivial derivations.
- Fixed `chat.tsx` repeated `reverse()` by merging paginated messages into a stable chronological array.

### PR 8: Accessibility, UI Consistency, and Cleanup (#723)

**Status:** Squash-merged.

- Replaced native form controls with design-system `<Select>`, `<Checkbox>`, `<Input>`, and `<Label>` primitives.
- Added `aria-label` to icon-only buttons, `DialogDescription` to dialogs, and icon+text status badges.
- Replaced inline SVGs in `DashboardContent` with `lucide-react` icons.
- Removed production `console.log` statements and `alert()` error handling from `app/instructor/profile/profile-form.tsx`.
- Extracted `BackfillImagesPanel` from `app/admin/instructors/page.tsx` and payment helpers from `inngest/functions/payments.ts` into `payments-helpers.ts`.
- Applied follow-up review fixes (CodeRabbit/Greptile) and squash-merged into `main`.

---

## Summary

| PR | Theme | Status | Approximate Items |
|----|-------|--------|-------------------|
| 1 | Security & architecture hardening | Merged (#710) | 4 |
| 2 | API / data layer consolidation | Merged (#712) | 5 |
| 3 | Session actions consolidation & reschedule correctness | Merged (#716) | 5 |
| 4 | Image upload consolidation & Next.js Image migration | Merged (#717) | 4 |
| 4.5 | Shared ImageUploadField / CropDialog in `@mentorships/ui` | Merged (#719) | 4 |
| 5 | Type safety & checkout UX | Merged (#720) | 4 |
| 6 | Testing infrastructure | Merged (#721) | 3 |
| 7 | Performance & loading states | Merged (#722) | 6 |
| 8 | Accessibility, UI consistency, and cleanup | Merged (#723) | 8 |

**Total PRs:** 8

---

## PR 1: Security & Architecture Hardening

*High priority. Architectural policy fixes and security issues.*

### 1.1. Supabase Storage Used for Instructor Onboarding Data

- **File:** `app/instructor/onboarding/page.tsx` (lines 9, 89–103)
- **Problem:** The page imports `createSupabaseAdminClient` and `ONBOARDING_BUCKET` from `@/lib/supabase-admin.ts` and calls `supabase.storage.from(ONBOARDING_BUCKET).createSignedUrl(...)` to load onboarding images.
- **Rule violation:** Per project policy: *Convex is the source of truth for instructor data (profile, tokens, inventory). Supabase/Postgres should NOT be used for instructor data in apps/platform.*
- **Impact:** Creates a second source of truth for instructor-facing onboarding data.
- **Fix:** Migrate onboarding images to Convex Storage. Use a Convex query to generate signed URLs for `imageObjects` and remove the Supabase dependency from this page.

### 1.2. Unsanitized HTML in Email Preview

- **File:** `components/instructor/email-preview-tab.tsx` (line 142)
- **Problem:** Renders email preview HTML directly via `dangerouslySetInnerHTML={{ __html: preview.html }}`. The server-side route (`/api/instructor/sessions/[sessionId]/email-preview`) does not appear to sanitize output, and the client does not use DOMPurify or similar.
- **Impact:** Stored/reflected XSS vector if any user-controlled input reaches email HTML.
- **Fix:** Sanitize `preview.html` on the server before returning it, or sanitize on the client with DOMPurify. Prefer a structured React preview component if possible.

### 1.3. N+1 Product Lookup in Admin Instructors List

- **File:** `app/api/admin/instructors/route.ts` (lines 36–57)
- **Problem:** Fetches all instructors, then loops in chunks and queries `api.products.getProductsByInstructorId` for each instructor.
- **Impact:** Latency grows linearly with instructor count; each request adds Convex round-trips.
- **Fix:** Add a single Convex query `getProductsByInstructorIds` that accepts an array of instructor IDs and returns a map, or denormalize `productActiveOneOnOne`/`productActiveGroup` flags onto the instructor document.

### 1.4. Hardcoded Admin Email in API Route

- **File:** `app/api/instructor/inventory/route.ts` (lines 10–12)
- **Problem:** `ADMIN_EMAILS` defaults to `["admin@huckleberry.art"]` inside the route.
- **Fix:** Move to environment variable validation with a default.

---

## PR 2: API / Data Layer Consolidation

*Standardize how server and client code talks to Convex and to internal API routes.*

### 2.1. Inconsistent Convex Client Initialization

- **Files:** `app/api/admin/instructors/route.ts`, `app/api/admin/instructors/upload/route.ts`, `app/api/admin/instructors/[id]/route.ts`, `inngest/functions/inventory-sync.ts`, etc.
- **Problem:** Some routes use `new ConvexHttpClient(convexUrl)` directly; others use `getAuthenticatedConvexClient()`; others use `convexServerCall()`. Auth is set in different ways.
- **Fix:** Standardize on a single factory (e.g., `getAuthenticatedConvexClient(token)`) for all server-side Convex calls.

### 2.2. Direct `fetch` Calls Scattered Through Client Code

- **Files:** `app/instructor/profile/profile-form.tsx`, `app/admin/instructors/[id]/edit/page.tsx`, `components/settings/google-calendar-card.tsx`, `components/instructor/session-actions.tsx`, `components/workspace/session-count-controls.tsx`, and many others.
- **Problem:** Many components call `fetch()` directly with inconsistent error handling, response parsing, and type safety. A typed `apiFetch` already exists in `lib/queries/api-client.ts` but is not used everywhere.
- **Fix:** Migrate all direct fetch calls to `apiFetch` or generated TanStack Query hooks, and centralize API endpoint definitions.

### 2.3. Inline API Endpoint Strings

- **Problem:** API paths like `/api/instructor/profile`, `/api/admin/instructors/upload`, etc., are repeated as string literals across components.
- **Fix:** Centralize API routes in a `routes.ts` or generated API client.

### 2.4. Payment Functions Use Custom `convexQuery`/`convexMutation` Wrappers

- **File:** `inngest/functions/payments.ts`
- **Problem:** Defines inline `convexQuery`/`convexMutation` helpers that manually construct Convex HTTP requests. This duplicates logic in `convexServerCall` and other helpers.
- **Fix:** Reuse the existing `convexServerCall` abstraction or use official Inngest/Convex patterns.

### 2.5. `api.users.syncUser` Called with `{} as any` or `{}`

- **Files:** `app/api/admin/instructors/backfill-images/route.ts` (line 60), `app/api/admin/instructors/upload/route.ts` (line 92)
- **Problem:** `await convex.mutation(api.users.syncUser, {} as any)` and `api.users.syncUser, {}` with no arguments when the generated mutation likely has a required schema.
- **Fix:** Pass the correct arguments or use `undefined` if the schema permits it.

---

## PR 3: Session Actions Consolidation & Reschedule Correctness

*Consolidate duplicate session-action dialogs and fix related UX/timezone bugs.*

### 3.1. Near-Duplicate Session Action Dialogs

- **Files:** `components/instructor/session-actions.tsx` (396 lines) and `components/instructor/student-detail-session-actions.tsx` (326 lines)
- **Problem:** Both implement nearly identical `RescheduleSessionDialog`, `CancelSessionDialog`, and `SessionNotesDialog` components. Logic for formatting dates, calling `/api/sessions/{id}/reschedule|cancel|notes`, and toast handling is duplicated.
- **Fix:** Extract a shared `SessionActionsProvider` or composable `SessionActionDialog` primitives. Use a single source of truth for API calls and validation.

### 3.2. `useTransition` Combined with Async Fetch in Session Actions

- **File:** `components/instructor/session-actions.tsx` (lines 66–92)
- **Problem:** `startTransition(async () => { ... await fetch(...) })` is used. React's `useTransition` is intended for synchronous transitions; async transitions are experimental and can cause unexpected behavior.
- **Fix:** Use the manual `isPending` pattern from `student-detail-session-actions.tsx` or use a TanStack `useMutation` hook.

### 3.3. `formatDateForInput` Does Not Account for Timezone in `datetime-local`

- **Files:** `components/instructor/session-actions.tsx`, `components/instructor/student-detail-session-actions.tsx`
- **Problem:** `new Date(ms).getHours()` returns local time, but the stored session time is UTC milliseconds. The reschedule dialog may display the wrong time depending on the user's local zone.
- **Fix:** Convert UTC to the instructor's configured timezone before formatting and back to UTC on submit.

### 3.4. `EnsureInstructorRole` Silently Ignores All Failures

- **File:** `components/instructor/ensure-instructor-role.tsx` (line 16)
- **Problem:** `fetch("/api/instructor/sync-role", { method: "POST" }).catch(() => {})` swallows every error.
- **Fix:** Surface failures with toasts on repeated errors, or at least log them to observability.

### 3.5. Race Condition in `EmailPreviewTab`

- **File:** `components/instructor/email-preview-tab.tsx` (lines 46–56)
- **Problem:** The `useEffect` that resets state on dependency changes is decoupled from the `useEffect` that fetches the preview. The reset and fetch can interleave if the user toggles tabs rapidly.
- **Fix:** Combine reset + fetch into a single effect, or use `useCallback` with a stable async handler and `AbortController`.

---

## PR 4: Image Upload Consolidation & Next.js Image Migration

*Consolidate three similar image upload components and migrate previews to Next.js `Image`.*

> **Detailed implementation plan:** [`docs/plans/pr-4-image-upload-consolidation.md`](../../docs/plans/pr-4-image-upload-consolidation.md)

### 4.1. Duplicated Image Upload Components

- **Files:** `components/admin/admin-image-upload.tsx`, `components/admin/instructor-image-upload.tsx`, `components/admin/image-upload-field.tsx`
- **Problem:** Three components share almost identical drag-and-drop, URL input, preview, and error handling logic. Differences are minor: crop support, upload endpoint, and multi-file support.
- **Fix:** Build a single `ImageUploadField` with configurable options:
  - `uploadEndpoint`, `multiple`, `maxFiles`, `onMultipleUpload`
  - `onUploadComplete(url, path)` for instructor uploads
  - `instructorId` + `type` (`profile` | `portfolio` | `result`) for the instructor admin route
  - `enableCrop` + `cropAspectRatio` (platform only; `react-image-crop` is installed there)
- **Scope:** Consolidate per app first. Cross-app extraction into `@mentorships/ui` is a follow-up because `apps/web` does not currently depend on `react-image-crop`.

### 4.2. `<img>` Tags Instead of Next.js `Image`

- **Files:**
  - Upload components: `components/admin/admin-image-upload.tsx`, `components/admin/instructor-image-upload.tsx`, `components/admin/image-upload-field.tsx`
  - Workspace: `components/workspace/notes.tsx` (line 1196)
  - Onboarding: `app/instructor/onboarding/page.tsx` (line 219)
  - Web admin/instructor forms: `app/admin/instructors/[id]/edit/page.tsx`, `app/admin/instructors/create/page.tsx`, `app/instructor/profile/profile-form.tsx`
- **Problem:** Uses plain `<img>` for previews, losing Next.js image optimization, lazy loading, and layout stability.
- **Fix:** Use Next.js `Image` with `unoptimized` for all dynamic/external Convex Storage URLs. For data URLs in `notes.tsx`, use explicit `width`/`height` + `unoptimized`.

### 4.3. Missing Image Remote Pattern in `apps/web`

- **File:** `apps/web/next.config.ts`
- **Problem:** `apps/platform` already allows `**.convex.cloud`, but `apps/web` has no remote image patterns. Uploaded images will fail when migrated to Next.js `Image`.
- **Fix:** Add the same `images.remotePatterns` entry for `**.convex.cloud` to `apps/web/next.config.ts`.

### 4.4. Backup Files Left in Source Tree

- **Files:**
  - `apps/platform/components/landing/instructor-carousel.tsx.bak`
  - `apps/web/components/landing/instructor-carousel.tsx.bak`
- **Problem:** `.bak` files are committed to the repo.
- **Fix:** Delete both files.

### 4.5. Follow-up PR: Extract `ImageUploadField` to `@mentorships/ui`

- **Status:** PR opened (#719).
- **Problem:** After PR 4, each app still had its own copy of `ImageUploadField`. The long-term goal is a single shared component.
- **Fix:** Move `ImageUploadField` and `CropDialog` to `packages/ui/src/components/`. Add `react-dropzone`, `lucide-react`, `react-image-crop`, and the minimal UI primitives they depend on (`Button`, `Input`, `Label`, `Dialog`) to the shared package. Install `react-image-crop` in `apps/web`. Re-export the component and UI primitives from both apps so existing imports continue to resolve.
- **Verification:** `pnpm --filter @mentorships/ui typecheck`, `pnpm --filter @mentorships/web build`, `pnpm --filter @mentorships/platform build` pass.
- **Plan:** See [`docs/plans/pr-4-image-upload-consolidation.md`](../../docs/plans/pr-4-image-upload-consolidation.md) §8.

---

## PR 5: Type Safety & Checkout UX

*Clean up `as any` casts and fix the checkout flow's validation/state bugs.*

### 5.1. Widespread `as any` Casts

- **Files:** `app/checkout/page.tsx` (lines 82, 182), `app/instructors/[slug]/page.tsx` (lines 95, 184, 193, 218, 342, 359), `lib/queries/convex/use-instructors.ts` (line 36), `app/api/admin/instructors/route.ts` (lines 38, 44), `app/api/admin/instructors/backfill-images/route.ts` (many `as any`)
- **Problem:** `as any` casts bypass TypeScript safety. Root cause is often incomplete or unshared types between Convex generated types and UI types.
- **Fix:** Define shared TypeScript interfaces (e.g., `InstructorDetail`, `Product`, `PublicInstructor`) and propagate them. Fix the underlying type mismatches instead of casting.

### 5.2. `useForm` from `@tanstack/react-form` Mixed with Manual State

- **Files:** `components/instructor/availability-settings-form.tsx`, `app/admin/products/_components/product-form.tsx`
- **Problem:** `useForm` is used but individual fields are read and set via `form.getFieldValue` and `form.setFieldValue` inside event handlers, bypassing the form's validation and submission lifecycle.
- **Fix:** Use `form.Field` sub-components or `form.handleChange`/`form.handleSubmit` properly.

### 5.3. `checkout/page.tsx` Form Validation Throws in Mutation

- **File:** `app/checkout/page.tsx` (lines 130–152)
- **Problem:** The `checkoutMutation.mutationFn` calls `setFormError` and then `throw new Error("Email and full name are required")` when guest details are missing.
- **Fix:** Validate before calling `mutate`, set field-level errors, and disable the checkout button until valid.

### 5.4. `checkout/page.tsx` `paymentMethod` State Reset Can Cause Extra Renders

- **File:** `app/checkout/page.tsx` (lines 117–128)
- **Problem:** `useEffect` updates `paymentMethod` when `selectedProduct` changes. Because `paymentMethod` is also in the dependency array, this can cause multiple renders and unexpected resets.
- **Fix:** Remove `paymentMethod` from the dependency array and derive the default payment method at selection time rather than in an effect.

---

## PR 6: Testing Infrastructure — Detailed Plan

*Add automated coverage for critical UI, API, and E2E paths.*

See the full implementation plan: [`docs/plans/pr-6-testing-infrastructure.md`](../docs/plans/pr-6-testing-infrastructure.md).

### 6.1. Test Setup Improvements

- Add shared `tests/unit/test-utils.tsx` with TanStack Query provider and a `renderWithProviders` helper.
- Update `tests/unit/setup.ts` to export mocks, add DOM API polyfills, and mock `next/image`.
- Add a small `tests/unit/api-route-utils.ts` helper for invoking Next.js route handlers directly.

### 6.2. Component Tests

- `apps/platform/components/instructor/session-actions.tsx` — reschedule, cancel, notes dialogs.
- `apps/web/components/calendar/book-session-form.tsx` — pack selection, slot loading, booking.
- `apps/platform/components/workspace/chat.tsx` — text/image send, empty/loading states.
- `packages/ui/src/components/image-upload-field.tsx` — drop, preview, upload, crop, URL input.
- `apps/platform/app/admin/instructors/create/page.tsx` — form validation, slug generation, submission.

### 6.3. API Route Tests

- `apps/platform/app/api/auth/sync/route.ts` — auth, validation, success, failure.
- `apps/platform/app/api/bookings/route.ts` — auth, validation, conflict, success, rollback.
- `apps/web/app/api/checkout/stripe/route.ts` — auth, validation, success, guest checkout.
- `apps/platform/app/api/sessions/[sessionId]/reschedule/route.ts` — auth, ownership, conflict, success.

### 6.4. E2E Playwright Tests

- Student purchase + booking flow.
- Instructor rescheduling.
- Google Calendar connect (skip if no OAuth bypass in env).
- Student onboarding submission.

**Note:** These four E2E flows are deferred to a follow-up PR because they require a seeded test backend and cannot be reliably mocked through Playwright's browser request interception against the current Convex setup. The unit, component, and API route tests are included in this PR.

### 6.5. Verification

- `pnpm test:unit`
- `pnpm test:convex`
- `pnpm typecheck`
- `pnpm run lint`
- `npx greptile@latest review`

---

## PR 7: Performance & Loading States

*Improve perceived performance, reduce bundle size, and clean up data-loading patterns.*

> **Detailed implementation plan:** [`docs/plans/pr-7-performance-loading-states.md`](../../docs/plans/pr-7-performance-loading-states.md)

### 7.1. Missing Suspense Boundaries on Many Pages

- **Files:** Most pages under `app/`, e.g., `app/instructor/dashboard/page.tsx`, `app/instructor/profile/page.tsx`, `app/admin/page.tsx`.
- **Problem:** Only a few pages (`dashboard`, `sessions`, `checkout`, `waitlist`, `free-mentorship`) use `Suspense`. Many client "use client" pages render loading spinners inline, blocking the entire page.
- **Fix:** Wrap independent data sections in `<Suspense>` with meaningful fallbacks. Move data fetching into server components where possible.

### 7.2. Client-Side Mock Instructor Data in `lib/instructors.ts`

- **File:** `lib/instructors.ts` (386 lines of mock data)
- **Problem:** Large static JSON is bundled into client and server bundles and used by landing pages and navigation.
- **Fix:** Remove mock data from production. Use Convex public queries for landing pages and navigation. Keep fixtures in a test-only file.

### 7.3. `DashboardContent` Fetches `/api/bookings/me` and `/api/google/calendars` with No Query Invalidation

- **File:** `app/dashboard/DashboardContent.tsx` (lines 165–244)
- **Problem:** Two `useEffect` blocks manually call `fetch` for Google bookings and calendar status. These are not part of TanStack Query, so they do not benefit from caching, deduplication, background refetch, or invalidation.
- **Fix:** Convert both to custom `useQuery` hooks (e.g., `useGoogleBookings`, `useGoogleCalendarStatus`).

### 7.4. `sessionStorage` Used as a State Cache

- **Files:** `app/dashboard/DashboardContent.tsx`, `components/settings/google-calendar-card.tsx`
- **Problem:** Google Calendar "not connected" status is cached in `sessionStorage` and read directly in components.
- **Fix:** Move to a TanStack Query cache or a small global store.

### 7.5. Unnecessary `useMemo` for Simple Values

- **Files:** `app/checkout/page.tsx`, `components/instructor/availability-settings-form.tsx`, etc.
- **Problem:** Simple string/date derivations are wrapped in `useMemo` with empty dependency arrays, adding overhead without benefit.
- **Fix:** Remove `useMemo` for trivial computations. Use constants or inline derivations.

### 7.6. Chat Component Reverses Paginated Array on Every Render

- **File:** `components/workspace/chat.tsx` (lines 367–370)
- **Problem:** `useMemo(() => (messagesRaw ? [...messagesRaw].reverse() : undefined), [messagesRaw])` creates a new array every time `messagesRaw` changes.
- **Fix:** Store messages in chronological order server-side or use a virtualized list for large histories.

---

## PR 8: Accessibility, UI Consistency, and Cleanup

*Medium-risk polish and cleanup. These are the last outstanding refactor items before the plan is complete.*

### Goal

1. Ensure every interactive control is accessible (labels, ARIA, keyboard focus, screen-reader feedback).
2. Replace native HTML inputs and custom dialogs with the project's design-system primitives.
3. Stop relying on color alone to communicate status.
4. Remove production `console.log` statements and browser `alert()` error handling.
5. Replace inline SVGs with cached icons or file imports.
6. Decompose the largest remaining files where the risk is low.

### Suggested in-PR execution order

1. **Quick wins** — remove `console.log` and `alert()` calls, replace inline SVGs, add `aria-label` to icon-only buttons.
2. **Status and badges** — add icon + text to all color-only status badges.
3. **Forms** — standardize inputs and add labels.
4. **Dialogs** — convert custom modals to the `Dialog` primitive.
5. **File decomposition** — split the largest files while preserving behavior.
6. **Verification** — typecheck, lint, tests, accessibility scan, Greptile review.

---

### 8.1. Missing Labels on Native Inputs

- **Files:**
  - `components/instructor/scheduling-settings-form.tsx` (timezone `<select>`, day `<input type="checkbox">`, interval time `<input type="time">`)
  - `components/instructor/availability-settings-form.tsx` (buffer/booking-lead/advance `<select>`s, blocked-date `<input type="date">`)
  - `app/admin/instructors/[id]/edit/page.tsx` (native inputs in the edit form)
  - `app/admin/instructors/page.tsx` ("Show inactive" checkbox)
  - `app/admin/products/_components/product-form.tsx` (form inputs)
- **Problem:** Many controls are missing associated `<label>` elements or `aria-label` attributes, which hurts screen-reader usability and fails WCAG 2.1 form requirements.
- **Fix:**
  - Wrap every control in a `<Label htmlFor={id}>`.
  - For hidden-label controls (e.g., checkbox-only toggles), use `aria-label` or `aria-labelledby`.
  - Use a unique, stable `id` for each control (e.g., `field.name`, `day-${day}-${field}`, or `uuid()`).

### 8.2. Native HTML Inputs Instead of Design-System Components

- **Files:** Same as 8.1, plus `components/instructor/session-actions.tsx` (`datetime-local` in reschedule dialog).
- **Problem:** Raw `<select>`, `<input type="checkbox">`, `<input type="date">`, `<input type="datetime-local">`, and `<input type="radio">` bypass styling, keyboard handling, and validation feedback already built into the UI primitives.
- **Fix:**
  - Replace `<select>` with the `<Select>` / `<SelectTrigger>` / `<SelectValue>` / `<SelectContent>` / `<SelectItem>` primitive.
  - Replace `<input type="checkbox">` with the `<Checkbox>` primitive.
  - Replace free-text/number/date inputs with `<Input>` (type-safe) and wrap them with `<Label>`.
  - For `datetime-local` in session-actions, either use `<Input type="datetime-local">` wrapped in a label, or introduce a dedicated `DateTimePicker` primitive if the project has one.
  - Keep all behavior identical; only the markup and styling should change.

### 8.3. Status Indicated Only by Color

- **Files:**
  - `app/instructor/sessions/sessions-list-client.tsx` (session status badges)
  - `app/dashboard/DashboardContent.tsx` (session-pack "left" badge, upcoming session badge, Google Calendar status)
  - `app/admin/instructors/page.tsx` (Active/Inactive badge)
- **Problem:** Color alone is not enough to convey status for color-blind users or in high-contrast modes.
- **Fix:**
  - Pair each status badge with a leading icon and human-readable text:
    - `scheduled` → `Clock` icon + "Scheduled"
    - `completed` → `CheckCircle2` icon + "Completed"
    - `canceled` → `XCircle` icon + "Canceled"
    - `no_show` → `AlertCircle` icon + "No show"
    - Active/Inactive → `CheckCircle2` / `XCircle` icon + text
  - Keep the existing color variant as a secondary visual cue.
  - Add `aria-label` or `title` to icon-only status indicators if any remain.

### 8.4. Dialogs and Dropdowns Not Using Accessible Components

- **Files:**
  - `app/instructor/profile/profile-form.tsx` (testimonial and student-result dialogs)
  - `app/admin/instructors/[id]/edit/page.tsx` (any custom modals)
- **Problem:** Custom modal markup is missing focus trapping, `ESC` close, and `aria-modal` semantics.
- **Fix:**
  - Convert every modal to the existing `<Dialog>` / `<DialogContent>` / `<DialogHeader>` / `<DialogTitle>` / `<DialogDescription>` / `<DialogFooter>` primitives.
  - Ensure each dialog has a title and a description.
  - Wire the existing open state through `open` and `onOpenChange`.
  - Use the existing `Dialog` from `@/components/ui/dialog` (already imported in `profile-form.tsx` for the confirmation dialog, so reuse it for the testimonial/result dialogs).

### 8.5. `aria-label` Missing on Icon-Only Buttons

- **Files:**
  - `app/admin/instructors/page.tsx` (edit/preview icon buttons, purge icon-only state)
  - `components/instructor/session-actions.tsx` (reschedule/cancel/notes icon-only actions)
- **Problem:** Icon-only buttons lack accessible names, so screen readers announce them as "button" with no context.
- **Fix:**
  - Add `aria-label` to every button whose only visible content is an icon.
  - Keep the existing `title` or add a tooltip for sighted users.
  - For buttons with hidden text on small screens (e.g., `<span className="hidden sm:inline">Delete</span>`), keep an `aria-label` that matches the visible text.

### 8.6. Inline SVGs in Components

- **File:** `app/dashboard/DashboardContent.tsx` (Discord and Google icons)
- **Problem:** Long SVG path data is inlined in the component, inflating bundle size and preventing caching.
- **Fix:**
  - Replace with `lucide-react` icons if a reasonable substitute exists (e.g., `MessageCircle` for Discord, or use a generic external-link icon for Google Calendar).
  - If brand-specific shapes are required, move the SVGs into separate files under `public/icons/` or `components/icons/` and import them as components. For the Discord icon, consider adding a dedicated `DiscordIcon` component in `components/icons.tsx`.
  - Do not copy raw SVG paths inline in the page.

### 8.7. Debug and Console Logging in Production Code

- **Files:**
  - `components/instructor/scheduling-settings-form.tsx` (`console.log` on render, change, and save handlers)
  - `components/instructor/availability-settings-form.tsx` (line 61 in the original plan; verify current state)
  - `app/api/auth/google/route.ts` and `app/api/auth/google/callback/route.ts` (OAuth request/response logging)
  - Various API routes with `console.log` statements
- **Problem:** `console.log` in production code leaks request data and makes the browser console noisy.
- **Fix:**
  - Remove all non-error `console.log` calls from client components and API routes.
  - In API routes, log only structured errors/warnings through a proper logger or remove logging entirely. If request tracing is needed, use a request-id header and log only at `debug` level behind an environment flag.
  - In client components, keep the existing `toast` success/error feedback. If you need local-only debug logs, use the existing `logDebug` pattern that checks `process.env.NODE_ENV !== "production"`, but prefer removing them entirely.
  - Search for `console.log` and `console.debug` in `apps/platform` after the change and verify the only remaining logs are behind explicit debug guards or in test files.

### 8.8. `alert()` Used for Error Handling

- **File:** `app/instructor/profile/profile-form.tsx` (testimonial and student-result mutation `onError` handlers)
- **Problem:** Browser `alert()` blocks the UI and is a poor user-experience pattern.
- **Fix:**
  - Replace every `alert(...)` with `toast.error(...)` from the existing `sonner` setup.
  - Remove any now-redundant `setError`/`success` local state if the toast covers the same feedback.
  - Ensure error messages are user-friendly (e.g., "Failed to add testimonial" + the server message).

---

### 8.9. Large File Decomposition

The following files are still overly complex and worth splitting as part of this cleanup PR. Decompose each into smaller, focused files while preserving exact behavior and existing tests.

- **Files:**
  - `app/admin/instructors/[id]/edit/page.tsx` (~1,200 lines)
  - `app/admin/products/_components/product-form.tsx` (~945 lines)
  - `components/workspace/notes.tsx`
  - `components/workspace/chat.tsx` (~1,093 lines)
  - `inngest/functions/payments.ts` (~1,183 lines)
- **Suggested decomposition:**
  - `app/admin/instructors/[id]/edit/page.tsx` → separate form sections (Profile, Products, Socials, Testimonials/Student Results, Image Uploads) plus a hook for mutations.
  - `app/admin/products/_components/product-form.tsx` → pricing section, session-pack section, scheduling section, and a shared product-type selector.
  - `components/workspace/chat.tsx` → message list, input bar, attachment handling, and pagination hook.
  - `components/workspace/notes.tsx` → note list, note editor, and toolbar.
  - `inngest/functions/payments.ts` → payout calculator, Stripe helpers, webhook handler, and each Inngest function in its own file.
- **Acceptance:**
  - No functional change; existing tests must pass without modification.
  - New files live next to their consumers (co-located `components/.../notes/` directory, etc.) or under a clear `lib/` subdirectory.
  - Each new file should be under ~300 lines.

### 8.10. Verification and Acceptance Criteria

- **Accessibility:**
  - All form inputs are wrapped with labels or have `aria-label`.
  - All icon-only buttons have `aria-label`.
  - No status is conveyed by color alone.
  - All dialogs use the `Dialog` primitive and have a `DialogTitle`.
  - Run an automated accessibility check (e.g., `axe-core` via browser dev tools or a test helper) on the touched pages.
- **Code quality:**
  - No `console.log` remains in production code under `apps/platform` (except explicit debug guards or logging utilities).
  - No `alert(` calls remain in `apps/platform`.
  - No inline SVG brand icons in the edited components.
- **Build:**
  - `pnpm --filter @mentorships/platform typecheck` passes.
  - `pnpm --filter @mentorships/platform lint` passes.
  - `pnpm --filter @mentorships/platform build` passes.
  - `pnpm --filter @mentorships/platform test:unit` passes.
  - `pnpm test:convex` passes.
- **Review:**
  - Run `npx greptile@latest review` before opening the PR.
  - Ensure no new lint/type issues are introduced by the file decomposition.

### 8.11. Implementation Notes

Implemented on 2026-08-01. Files changed:

- **Forms and inputs:**
  - `components/instructor/scheduling-settings-form.tsx` — removed debug logs, replaced native `<select>`/`checkbox`/`time` with `<Select>`, `<Checkbox>`, and `<Input>`, added labels/aria-labels.
  - `components/instructor/availability-settings-form.tsx` — replaced native `<select>` with `<Select>`, added labels/ids.
  - `app/admin/instructors/[id]/edit/page.tsx` — replaced native `isActive` checkbox with `<Checkbox>`.
  - `app/admin/products/_components/product-form.tsx` — replaced native Stripe/PayPal checkboxes with `<Checkbox>` and `<Label>`.
  - `components/instructor/session-actions.tsx` — replaced native `<input type="datetime-local">` with `<Input>` and `<Label>`, added `DialogDescription`.
- **Accessibility:**
  - `app/admin/instructors/page.tsx` — converted "Show inactive" to `<Checkbox>` + `<Label>`, added `aria-label` to icon-only edit/view buttons, added icon+text to Active/Inactive badges, extracted `BackfillImagesPanel` to `app/admin/instructors/_components/backfill-images-panel.tsx`.
  - `app/instructor/profile/profile-form.tsx` — replaced inline SVG portfolio remove button with `<Button>` and `X` icon, added `aria-label` to delete buttons, replaced `alert()` with `toast.error()`, added `DialogDescription` and `htmlFor` labels.
  - `app/instructor/sessions/sessions-list-client.tsx` — added icon+text `StatusBadge`.
  - `app/dashboard/DashboardContent.tsx` — replaced inline Discord/Google/info SVGs with `lucide-react` icons, added icon+text to badges.
- **Observability:**
  - Removed `console.log` from `app/api/auth/google/*`, `app/api/admin/upload`, `app/api/admin/instructors/[id]`, `app/api/checkout/*`, `app/api/instructor/settings`, and `app/api/webhooks/clerk`.
  - Removed the empty `logDebug` helper from `app/api/instructor/settings/route.ts`.
- **Decomposition:**
  - Extracted helper functions (`escapeHtml`, `formatPrice`, `getInstructorNameFromClerk`, `findClerkUserIdByEmail`, `parseEmailResult`) from `inngest/functions/payments.ts` into `inngest/functions/payments-helpers.ts`.
  - Extracted `BackfillImagesPanel` from `app/admin/instructors/page.tsx` into `app/admin/instructors/_components/backfill-images-panel.tsx`.

**Follow-up review fixes applied after merge commit `840d2020`:**
- `backfill-images-panel.tsx` — added explicit `type="button"` to all panel buttons, added `role="alert"` to the error message, removed the unused Dry run checkbox, added numeric `type="number" min={1}` to the batch limit, initialized `baseUrl` from `window.location.origin`, moved `BackfillResponse` to module scope, deferred `URL.revokeObjectURL`, and reset `confirmRun` after a live run.
- `admin/instructors/page.tsx` — conditionally rendered the public profile link only when `instructor.slug` exists.
- `product-form.tsx` — added `aria-describedby` references between Stripe/PayPal checkboxes and their descriptions.
- `api/admin/instructors/[id]/route.ts` — wrapped `req.json()` in try/catch for invalid bodies, returned generic 500 error messages, and removed `userId` from the Clerk deletion error log.
- `profile-form.tsx` — made portfolio remove buttons visible by default on mobile/touch and hidden-by-default only on desktop hover.
- `scheduling-settings-form.tsx` — used a non-empty sentinel for the "(not set)" timezone option.
- `payments-helpers.ts` — added a 10-second fetch timeout to the Clerk user lookup.
- `api/webhooks/clerk/route.ts` — removed the redundant diagnostic body-parsing block before `verifyWebhook`.

**Final verification:**
- `pnpm --filter @mentorships/platform typecheck` ✅
- `pnpm --filter @mentorships/platform lint` ✅ (0 errors; pre-existing warnings remain)
- `NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm --filter @mentorships/platform build` ✅
- `CI=true pnpm run test:unit` ✅ (353 passed, 3 skipped)
- `npx greptile@latest review -b main --diff` ✅ (0 comments, 5/5 confidence)

**Status:** Squash-merged into `main` via PR #723. Branch `pr-8-accessibility-ui-cleanup` deleted.

---

## Large/Overly Complex Files Worth Splitting

These files appear across multiple PRs above but are worth calling out as cross-cutting decomposition work:

- `app/admin/instructors/[id]/edit/page.tsx` (1207 lines)
- `app/admin/products/_components/product-form.tsx` (945 lines)
- `components/workspace/notes.tsx`
- `components/workspace/chat.tsx` (1093 lines)
- `inngest/functions/payments.ts` (1183 lines)

Where possible, decompose these as part of the relevant PRs rather than as a standalone PR.

---

## Recommended Execution Order

1. **PR 1: Security & Architecture Hardening** — Highest risk and policy impact.
2. **PR 2: API / Data Layer Consolidation** — Unblocks cleaner work in PRs 3, 4, and 5.
3. **PR 3: Session Actions Consolidation** — Fixes a real user-facing reschedule/timezone bug.
4. **PR 4: Image Upload Consolidation** — Reduces duplication and improves image performance.
5. **PR 5: Type Safety & Checkout UX** — Reduces TypeScript risk and fixes checkout flow issues.
6. **PR 6: Testing Infrastructure** — Add tests before larger refactors to establish baselines.
7. **PR 7: Performance & Loading States** — Improves perceived performance and bundle size.
8. **PR 8: Accessibility, UI Consistency, and Cleanup** — Medium-risk polish and cleanup; the last remaining PR in this plan.

---

## What Remains

All eight planned PRs are merged, but the following cross-cutting items were intentionally deferred or only partially addressed and are the next candidates for focused work:

### Large-file decomposition

The files below are still oversized. PR 8 only extracted the payment helpers and the backfill panel; the main bodies remain intact.

- `app/admin/instructors/[id]/edit/page.tsx` (~1,200 lines) — split into section components (Profile, Products, Socials, Testimonials/Results, Images) plus a shared hook.
- `app/admin/products/_components/product-form.tsx` (~945 lines) — split into pricing, session-pack, scheduling, and product-type sections.
- `components/workspace/chat.tsx` (~1,093 lines) — split into message list, input bar, attachment handling, and pagination hook.
- `components/workspace/notes.tsx` — split into note list, editor, and toolbar.
- `inngest/functions/payments.ts` (~1,183 lines) — split each Inngest function and the webhook handler into separate files under `inngest/functions/payments/`.

### E2E / Playwright coverage

PR 6 deferred the Playwright flows because they require a seeded test backend:

- Student purchase + booking flow.
- Instructor rescheduling.
- Google Calendar connect (skip if no OAuth bypass).
- Student onboarding submission.

### Accessibility verification

- No automated `axe-core` scan has been run on the touched pages. Add a CI or test helper that fails on new violations.
- Some pre-existing lint warnings remain (unescaped entities, unused variables, `useMemo` dependency drift). These are non-blocking but should be cleaned up opportunistically.

### Code quality hygiene

- CodeRabbit docstring coverage warning (26.92% vs 80% threshold). This is not blocking but will surface on every PR until addressed.

---

*This document is a snapshot of findings as of 2026-08-01 and should be updated as PRs are merged.*

# PR 6: Testing Infrastructure — Detailed Plan

**PR number:** 6
**Theme:** Add automated test coverage for critical UI, API, and E2E paths.
**Status:** Ready for review
**Target branch:** `main`
**Estimated size:** Medium-Large
**Primary app:** `apps/platform` (with shared tests in `tests/`)

## 1. Goal

Establish reliable, maintainable test baselines for the most user-critical paths before larger refactors (PR 7 and PR 8). This PR is **focused on tests and test infrastructure only**; it should not change production behavior except for small, test-only refactors (e.g., extracting a pure helper, adding a `data-testid` where absolutely necessary).

## 2. Why now

- PRs 1–5 are merged and stabilized.
- PR 7 (performance) and PR 8 (a11y) will touch many components. Without tests, regressions will be hard to detect.
- Several critical flows (booking, rescheduling, onboarding, checkout) currently have no automated coverage.

## 3. Scope

### 3.1 In scope

- Shared test utilities (TanStack Query provider, router mock updates, Convex mock helpers).
- Component tests for:
  - `apps/platform/components/instructor/session-actions.tsx` (reschedule, cancel, notes).
  - `apps/web/components/calendar/book-session-form.tsx` (booking flow).
  - `apps/platform/components/workspace/chat.tsx` (sending text and images).
  - `apps/web/components/admin/image-upload-field.tsx` (re-export from `@mentorships/ui`; tests live in `packages/ui`).
  - `apps/platform/app/admin/instructors/create/page.tsx` (instructor creation form).
- API route tests for:
  - `apps/platform/app/api/auth/sync/route.ts`.
  - `apps/platform/app/api/bookings/route.ts`.
  - `apps/web/app/api/checkout/stripe/route.ts` (success/error path).
  - `apps/platform/app/api/sessions/[sessionId]/reschedule/route.ts`.
- E2E Playwright specs for:
  - Student purchasing a session pack and booking a session.
  - Instructor rescheduling a session.
  - Connecting Google Calendar from the dashboard.
  - Student submitting onboarding.

### 3.2 Out of scope

- Refactoring production code (that belongs to PR 7 and PR 8).
- Adding Storybook or visual regression.
- Full test coverage for every route; focus on the highest-risk flows.

## 4. Current state

- `vitest.config.mjs` (root) runs unit tests with `jsdom` and React Testing Library.
- `convex/vitest.config.mjs` runs Convex function tests with `edge-runtime`.
- `tests/unit/setup.ts` already mocks `next/navigation` and Clerk, but the mocks are incomplete for newer `@clerk/nextjs` versions and do not provide a TanStack Query provider.
- E2E specs exist in `tests/e2e/` but several are placeholders (`stripe-checkout.spec.ts`) or narrowly scoped (video calls, chat submit, notes editor).
- No shared `renderWithProviders` helper exists.
- No Mock Service Worker (MSW) setup exists for API route tests.

## 5. Test setup improvements

### 5.1 Shared test utilities

Create `tests/unit/test-utils.tsx`:

```tsx
import React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
      <Toaster />
    </QueryClientProvider>
  );
}
```

Update `tests/unit/setup.ts`:

- Export the existing mocks so individual tests can override them.
- Add `global.ResizeObserver` and `IntersectionObserver` polyfills for `react-dropzone` and other DOM APIs.
- Add a `beforeEach` that clears `vi` mocks.

### 5.2 Mocking TanStack Query hooks

For component tests, prefer mocking the query hooks at the module level rather than mocking the entire Convex client. Example:

```ts
vi.mock("@/lib/queries/convex", () => ({
  useCurrentInstructor: vi.fn(),
  useRescheduleSession: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCancelSession: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateSessionNotes: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
```

### 5.3 Mocking `next/image`

Add to `tests/unit/setup.ts`:

```ts
vi.mock("next/image", () => ({
  default: (props: any) => React.createElement("img", { ...props, src: props.src }),
}));
```

### 5.4 API route test harness

Add a small helper `tests/unit/api-route-utils.ts` that uses `NextRequest` directly to call the route handlers without a server. Example pattern:

```ts
import { NextRequest } from "next/server";

export function makeRequest({
  method = "GET",
  url,
  body,
  headers,
}: { method?: string; url: string; body?: object; headers?: Record<string, string> }) {
  return new NextRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}
```

## 6. Component tests

### 6.1 `SessionActions` (reschedule / cancel / notes)

**File:** `apps/platform/components/instructor/session-actions.test.tsx`

**Mocked dependencies:**
- `@/lib/queries/convex` → `useCurrentInstructor`
- `@/lib/queries/use-session-actions` → `useRescheduleSession`, `useCancelSession`, `useUpdateSessionNotes`
- `next/navigation` → `useRouter` (already in setup)

**Test cases:**
1. Renders reschedule, cancel, and notes buttons.
2. Reschedule button is disabled while instructor timezone is loading.
3. Reschedule button is disabled if instructor has no valid timezone.
4. Opens reschedule dialog and shows current student/time.
5. Calls reschedule mutation with correct UTC timestamp when a new date is submitted.
6. Opens cancel dialog and calls cancel mutation with reason.
7. Opens notes dialog and saves notes.
8. Closes dialogs on Cancel/Keep Session.

### 6.2 `BookSessionForm`

**File:** `apps/web/components/calendar/book-session-form.test.tsx`

**Mocked dependencies:**
- `@/lib/queries/convex` → `useCreateSession`
- `@/lib/queries/api-client` → `fetchInstructorAvailability`
- `@tanstack/react-query` → leave real `useQuery` but mock the fetch function

**Test cases:**
1. Shows empty state when no eligible packs.
2. Renders pack dropdown and calls availability when Load slots is clicked.
3. Shows available slot buttons.
4. Calls `createSession.mutateAsync` with correct payload when a slot is clicked.
5. Shows error message when availability fails.
6. Shows Google Calendar not connected info when API returns 409.

### 6.3 `WorkspaceChat`

**File:** `apps/platform/components/workspace/chat.test.tsx`

**Mocked dependencies:**
- `@/lib/queries/convex/use-workspaces` → `useWorkspaceMessages`, `useCreateWorkspaceMessage`, `useCreateWorkspaceImage`

**Test cases:**
1. Renders loading state.
2. Renders empty state.
3. Renders messages in order with correct alignment.
4. Sends a text message when Enter is pressed.
5. Sends a text message when send button is clicked.
6. Ignores non-image file selection.
7. Shows image preview and sends image.
8. Clears preview on cancel.

### 6.4 `ImageUploadField` (shared component)

**File:** `packages/ui/src/components/image-upload-field.test.tsx`

**Mocked dependencies:**
- `react-dropzone` (use `mockImplementation` to simulate file drops)
- `next/image` (see setup)
- Upload API passed via props

**Test cases:**
1. Renders drop zone.
2. Accepts a single file via drop.
3. Shows image preview.
4. Calls `onUploadComplete` with URL after successful upload.
5. Shows error on upload failure.
6. Supports URL input when enabled.
7. Supports cropping when enabled.

### 6.5 `CreateInstructorPage`

**File:** `apps/platform/app/admin/instructors/create/page.test.tsx`

**Mocked dependencies:**
- `@/lib/queries/api-client` → `createAdminInstructor`, `uploadInstructorImage`
- `next/navigation` → `useRouter` (already in setup)

**Test cases:**
1. Generates slug from name.
2. Shows validation for invalid Discord URL.
3. Submits form and redirects to instructor list.
4. Shows server error message.
5. Uploads profile image when selected.

## 7. API route tests

### 7.1 `GET /api/auth/sync`

**File:** `apps/platform/app/api/auth/sync/route.test.ts`

**Mocked dependencies:**
- `@clerk/nextjs/server` → `auth`, `clerkClient`
- `@/lib/convex` → `getConvexClient`

**Test cases:**
1. Returns 401 when no Clerk session.
2. Returns 401 when Convex token is missing.
3. Syncs user and returns user id/email/role on success.
4. Returns 500 when Convex mutation fails.

### 7.2 `POST /api/bookings`

**File:** `apps/platform/app/api/bookings/route.test.ts`

**Mocked dependencies:**
- `@clerk/nextjs/server` → `auth`, `clerkClient`
- `@/lib/auth-helpers` → `requireAuth`
- `@/lib/convex` → `getAuthenticatedConvexClient`
- `@/lib/google` → `getGoogleCalendarClient`
- `@/lib/crypto` → `decryptInstructorRefreshToken`
- `@trigger.dev/sdk` → `tasks.trigger`

**Test cases:**
1. Returns 401 for unauthenticated request.
2. Returns 400 for invalid body.
3. Returns 404 when instructor not found.
4. Returns 409 when instructor has no refresh token.
5. Returns 409 when slot is busy.
6. Returns 409 when pending booking conflicts.
7. Returns 200 and triggers notification task on successful booking.
8. Rolls back pending booking on Google Calendar failure.

### 7.3 `POST /api/checkout/stripe`

**File:** `apps/web/app/api/checkout/stripe/route.test.ts`

**Mocked dependencies:**
- `@clerk/nextjs/server` → `auth`, `clerkClient`
- `@/lib/stripe` → `stripe`
- `@/lib/db` → `db` queries

**Test cases:**
1. Returns 401 for unauthenticated request.
2. Returns 400 for missing product/pack.
3. Returns 404 for invalid product.
4. Creates Stripe checkout session and returns URL.
5. Handles guest checkout when email/fullName provided.

### 7.4 `PATCH /api/sessions/[sessionId]/reschedule`

**File:** `apps/platform/app/api/sessions/[sessionId]/reschedule/route.test.ts`

**Test cases:**
1. Returns 401 for unauthenticated request.
2. Returns 400 for invalid body.
3. Returns 403 when user is not instructor or admin.
4. Returns 404 for unknown session.
5. Returns 409 when new time conflicts.
6. Returns 200 and updates session on success.

## 8. E2E tests

All E2E specs live in `tests/e2e/` and use `apps/platform/playwright.config.mts` (which has a `setup` project for auth). The root `package.json` `test` script currently points to `apps/web/playwright.config.mts`; decide whether to update it or add a separate `test:e2e:platform` script.

### 8.1 Purchase + booking flow

**File:** `tests/e2e/student-purchase-and-book.spec.ts`

**Setup:**
- Uses `auth.setup.ts` to sign in as a student test user.
- Requires a seeded test product and instructor with connected Google Calendar.

**Steps:**
1. Navigate to `/instructors` and select an instructor.
2. Click a product card and proceed to checkout.
3. Complete Stripe test checkout (use Stripe test card `4242 4242 4242 4242`).
4. Wait for redirect to `/checkout/success`.
5. Navigate to `/calendar`.
6. Select a session pack, load available slots, and book a session.
7. Verify the session appears on `/dashboard`.

### 8.2 Instructor rescheduling

**File:** `tests/e2e/instructor-reschedule.spec.ts`

**Setup:**
- Uses `auth.setup.ts` with instructor test user.
- Requires a pre-created scheduled session.

**Steps:**
1. Navigate to `/instructor/sessions`.
2. Click reschedule on a session.
3. Select a new date/time.
4. Submit and verify session time updated.

### 8.3 Google Calendar connect

**File:** `tests/e2e/google-calendar-connect.spec.ts`

**Steps:**
1. Sign in as instructor.
2. Navigate to `/instructor/availability`.
3. Click Connect Google Calendar.
4. Complete OAuth flow (or use a test bypass if available).
5. Verify dashboard shows connected status.

**Risk:** Google OAuth flow is hard to automate. Provide a `test.skip` path with a clear note if no test environment bypass exists.

### 8.4 Onboarding submission

**File:** `tests/e2e/student-onboarding.spec.ts`

**Steps:**
1. Sign in as student with a purchased pack.
2. Navigate to `/dashboard/onboarding`.
3. Upload goal images.
4. Fill goals text.
5. Submit and verify redirect to workspace.

## 9. Files to add/modify

### New files

- `tests/unit/test-utils.tsx`
- `tests/unit/api-route-utils.ts`
- `apps/platform/components/instructor/session-actions.test.tsx`
- `apps/web/components/calendar/book-session-form.test.tsx`
- `apps/platform/components/workspace/chat.test.tsx`
- `packages/ui/src/components/image-upload-field.test.tsx`
- `apps/platform/app/admin/instructors/create/page.test.tsx`
- `apps/platform/app/api/auth/sync/route.test.ts`
- `apps/platform/app/api/bookings/route.test.ts`
- `apps/web/app/api/checkout/stripe/route.test.ts`
- `apps/platform/app/api/sessions/[sessionId]/reschedule/route.test.ts`
- `tests/e2e/student-purchase-and-book.spec.ts`
- `tests/e2e/instructor-reschedule.spec.ts`
- `tests/e2e/google-calendar-connect.spec.ts`
- `tests/e2e/student-onboarding.spec.ts`

### Modified files

- `tests/unit/setup.ts` — add query provider, polyfills, exportable mocks.
- `vitest.config.mjs` — add `packages/ui` test alias if needed, ensure `ImageUploadField` imports resolve.
- `apps/platform/package.json` — add `test:unit` and `test:e2e` scripts (optional, root scripts already cover).
- `apps/platform/playwright.config.mts` — fix `testDir` if needed (currently points to `tests/e2e` which is correct).
- `apps/web/playwright.config.mts` — decide if E2E tests run against web or platform; document decision.
- `apps/platform/REFACTORING_AND_IMPROVEMENT_PLAN.md` — mark PR 6 as planned.

## 10. Dependencies

No new runtime dependencies. Possible dev dependencies:

- `msw` (optional) — if we prefer MSW over per-module mocks. Not required.
- `@testing-library/react-hooks` — only if testing hooks directly; likely not needed.

Confirm installed versions are adequate:
- `@testing-library/react` 16.3.0
- `@testing-library/user-event` 14.6.1
- `@testing-library/jest-dom` 6.9.1
- `vitest` 2.1.9
- `@playwright/test` 1.57.0

## 11. Verification

Run these before creating the PR:

```bash
# 1. Install any new dev dependencies
pnpm install

# 2. Unit tests
pnpm test:unit

# 3. Convex tests
pnpm test:convex

# 4. Typecheck
pnpm typecheck

# 5. Lint
pnpm run lint

# 6. E2E (requires dev server and test credentials)
pnpm test
```

Note: Some E2E tests may require seed data and Clerk/Stripe test credentials. If credentials are unavailable, keep the spec file but mark it as `test.skip` or `test.fixme` with a reason.

## 12. Greptile review

Run Greptile before opening the PR:

```bash
npx greptile@latest review
```

## 13. Risks

1. **Clerk mocking:** Root `setup.ts` mocks may not fully match current `@clerk/nextjs` APIs. We may need to adjust mocks per-component.
2. **Google Calendar E2E:** OAuth flow may be impractical to automate. Have a skip plan.
3. **Stripe checkout E2E:** Requires Stripe test keys and a seeded product. Document required env vars.
4. **Test flakiness:** `useQuery` in `BookSessionForm` may need act/waitFor patterns. Prefer mocking the hook if it becomes flaky.
5. **Large PR:** This touches many files. If it becomes too large, split into:
   - PR 6a: Test setup + component tests.
   - PR 6b: API route tests.
   - PR 6c: E2E specs.

## 14. Acceptance criteria

- [ ] All new unit tests pass.
- [ ] All new API route tests pass.
- [ ] Existing E2E specs still pass.
- [ ] At least one new E2E spec is implemented (even if others are skipped pending credentials).
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm run lint` passes.
- [ ] Greptile review returns no new issues.
- [ ] PR description links to this plan and lists all test files added.

## 15. Follow-up after merge

- Update `REFACTORING_AND_IMPROVEMENT_PLAN.md` to mark PR 6 as merged.
- Before PR 7, add a CI check that runs `pnpm test:unit` and `pnpm test:convex` on pull requests.
- Consider requiring E2E tests to pass on staging before production deploys.

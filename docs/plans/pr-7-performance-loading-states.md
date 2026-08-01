# PR 7: Performance & Loading States — Detailed Plan

**PR number:** 7
**Theme:** Improve perceived performance, reduce bundle size, and clean up data-loading patterns.
**Status:** Merged (#722)
**Target branch:** `main`
**Estimated size:** Medium
**Primary app:** `apps/platform`

## 1. Goal

Reduce client-side blocking, remove dead production data, and replace ad-hoc fetching/caching with the project's TanStack Query patterns. This PR is a **performance and data-hygiene refactor only**; it does not add new user-facing features.

## 2. Why now

- PR 6 established unit/component/API test baselines; we can now refactor with regression coverage.
- Several pages still load via `useEffect` + manual `fetch`, blocking the entire page until all requests resolve.
- `lib/instructors.ts` ships 386 lines of mock JSON in production bundles even though the real data lives in Convex.
- `sessionStorage` is used as a cache for Google Calendar connection status, which bypasses the QueryClient and is hard to invalidate.

## 3. Scope

### 3.1 In scope

1. Add `Suspense` boundaries to client pages that currently render loading spinners inline.
2. Remove `apps/platform/lib/instructors.ts` mock data and replace the one production consumer (`TestimonialsCarousel`) with a real Convex query.
3. Convert `DashboardContent` manual `getMyBookings` / `getGoogleCalendars` fetches to TanStack Query hooks.
4. Replace the Google Calendar `sessionStorage` cache with TanStack Query cache.
5. Remove unnecessary `useMemo` for trivial derivations.
6. Fix the chat component's repeated `reverse()` on every render.

### 3.2 Out of scope

- Replacing raw HTML inputs with design-system components (PR 8).
- Adding labels/aria-labels or replacing inline SVGs (PR 8).
- Migrating every page to SSR + TanStack Query streaming; this PR only adds Suspense boundaries around existing client components.
- Adding a virtualized chat library as a new dependency unless profiling shows it is required.

### 3.3 Context7 docs

This work relies on TanStack Query v5 patterns. Key references:

- [Suspense | TanStack Query React Docs](https://tanstack.com/query/v5/docs/framework/react/guides/suspense) — `useSuspenseQuery`, `useSuspenseQueries`, `QueryErrorResetBoundary`, and error-boundary pairing.
- [Advanced Server Rendering](https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr) — `prefetchQuery`, `dehydrate`, `HydrationBoundary`, and the `shouldDehydrateQuery` pending-query override for streaming.
- `@convex-dev/react-query` API — `convexQuery` returns options compatible with `useSuspenseQuery` when the query is not skipped; the global `queryFn` is already wired in `apps/platform/lib/providers/query-provider.tsx`.

## 4. Current state

### 4.1 Pages with inline loading

| Page | Pattern | Notes |
|------|---------|-------|
| `app/instructors/page.tsx` | `usePublicInstructors` + `isLoading` branch | Could suspend the grid and show a skeleton on the parent page. |
| `app/instructors/[slug]/page.tsx` | `useInstructorBySlug` + `isLoading` branch | Returns a full-screen spinner; header and static copy could render immediately. |
| `app/admin/page.tsx` | `useEffect` + manual `apiFetch` | No Suspense, no TanStack Query, no error boundary. |
| `app/dashboard/DashboardContent.tsx` | Mixed `useQuery` + `useEffect` fetches | `getMyBookings` and `getGoogleCalendars` are fetched manually. |
| `app/instructor/dashboard/page.tsx` | Server Component, `await fetchStudentSessionRows` | Blocks the whole page. |
| `app/instructor/sessions/page.tsx` | Server Component loads instructor, then client loads sessions | Good boundary candidate around `InstructorSessionsClient`. |
| `app/sessions/page.tsx` | Already wrapped in `<Suspense>` | `SessionsContent` still uses `useQuery` + `isLoading` internally. |
| `app/checkout/page.tsx` | Already wrapped in `<Suspense>` | Inner `CheckoutContent` still uses `useQuery` + `isLoading` branches. |

### 4.2 Mock data

`apps/platform/lib/instructors.ts` defines `mockInstructors` (386 lines) and exports `getRandomizedInstructors`, `getInstructorBySlug`, `getAvailableInstructors`, `getAlphabeticalInstructors`, `getInstructorNavigation`, `getNextInstructor`, `getPreviousInstructor`.

The only production consumer in `apps/platform` is:

- `components/testimonials/testimonials-carousel.tsx`: imports `mockInstructors` and `Testimonial` to build a carousel.

`scripts/seed-instructors.ts` imports from `apps/marketing/lib/instructors.ts`, which is a separate file and not affected.

### 4.3 Manual fetches in `DashboardContent`

`app/dashboard/DashboardContent.tsx` (lines 165–244):

- `useEffect` calls `getMyBookings()` → sets local `googleBookings` state.
- `useEffect` calls `getGoogleCalendars()` → sets local `googleCalendarConnected` state.
- Uses `sessionStorage.getItem(GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY)` to short-circuit the calendar check.

### 4.4 `sessionStorage` cache

`components/settings/google-calendar-card.tsx` uses the same `GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY` to avoid re-hitting the API when the calendar is known to be disconnected.

### 4.5 Unnecessary `useMemo`

Trivial derivations wrapped in `useMemo`:

- `app/checkout/page.tsx`: `productList` (filter by `mentorshipType`), `selectedProduct` (`.find` by id).
- `app/dashboard/DashboardContent.tsx`: `sortedPacks` (sort by `purchasedAt`), `uniqueInstructorCount` (count unique instructor IDs).
- `components/instructor/availability-settings-form.tsx`: `timeZones = useMemo(() => getTimeZones(), [])`.

### 4.6 Chat `reverse()`

`components/workspace/chat.tsx` line 367:

```tsx
const messages = useMemo<MessageList | undefined>(
  () => (messagesRaw ? [...messagesRaw].reverse() : undefined),
  [messagesRaw]
);
```

`messagesRaw` comes from the paginated Convex query (newest-first). Each pagination or live update yields a new array reference, so this creates and reverses a new array every render.

## 5. Implementation plan

### 5.1 Suspense boundaries

#### 5.1.1 Strategy

Use `useSuspenseQuery` from `@tanstack/react-query` for Convex-backed queries. `convexQuery` already returns options typed for `useSuspenseQuery` when the query is not skipped. The global `queryFn` in `QueryProvider` will run the Convex query.

For queries that must be disabled conditionally (e.g., no user id), use one of:

- `skipToken` (TanStack Query v5 supports `queryFn: skipToken` to disable).
- Conditional rendering: only mount the suspending component when the required parameter is available.
- Keep `useQuery` for admin/instructor availability where disabling is simpler and wrap the page in a coarse Suspense fallback.

Pair each new Suspense boundary with an `ErrorBoundary` (or `QueryErrorResetBoundary` + `ErrorBoundary` where a retry action is needed). For Next.js App Router pages, `error.tsx` is the simplest boundary; where it is missing, add it to the route segment.

#### 5.1.2 Page-by-page changes

1. **`app/instructors/page.tsx`**
   - Create `InstructorsGridContent` client component that calls `useSuspenseQuery(convexQuery(api.instructors.getPublicInstructors, {}))`.
   - Keep the static header and skeletons in the page.
   - Wrap the grid in `<Suspense fallback={<InstructorsSkeleton />}>` and an `ErrorBoundary`.
   - Delete the `isLoading`/`isError` branches inside the grid component.

2. **`app/instructors/[slug]/page.tsx`**
   - Split into `InstructorProfileHeader` (static copy + image) and `InstructorProfileBody` (extras, testimonials, results).
   - `InstructorProfileBody` can call `useSuspenseQuery(convexQuery(api.instructors.getInstructorBySlug, { slug }))` and `useSuspenseQuery(convexQuery(api.instructors.getTestimonialsByInstructorId, { instructorId }))` once the instructor ID is known.
   - Wrap body in `<Suspense>` with a skeleton; keep the header outside.
   - Leave the `notFound()` checks outside the Suspense boundary.

3. **`app/admin/page.tsx`**
   - Convert `AdminDashboard` to use TanStack Query:
     - `useSuspenseQuery({ queryKey: ["adminStats"], queryFn: getAdminStats })`.
     - `useSuspenseQuery({ queryKey: ["adminInstructors"], queryFn: () => getAdminInstructors() })`.
   - Wrap the stats cards and instructors table in separate `<Suspense>` boundaries so stats can render while the instructor table loads.
   - Replace the per-row student expansion fetch with `useQuery` + `enabled: !!expandedInstructorId` (or keep manual fetch if expanding is rare; no Suspense needed for a hidden detail panel).
   - Add `app/admin/error.tsx` to catch query errors with a retry button.

4. **`app/dashboard/page.tsx`** (already has Suspense)
   - Keep the existing Suspense wrapper.
   - Replace `DashboardContent` loading branches by splitting into `DashboardHeader` (Clerk user info) and `DashboardBody` (suspending on the new hooks from §5.3).

5. **`app/instructor/dashboard/page.tsx`**
   - Move `fetchStudentSessionRows` into a client component `InstructorDashboardContent` that uses `useSuspenseQuery(convexQuery(api.seatReservations.getInstructorStudentsWithRemainingSessions, { instructorId, limit }))`.
   - The server component only loads the instructor record; wrap the client component in `<Suspense>`.
   - Keep the "profile not found" guard outside Suspense.

6. **`app/instructor/sessions/page.tsx`**
   - Wrap `<InstructorSessionsClient />` in `<Suspense>` with a skeleton fallback.
   - This is the lowest-effort boundary because the page already separates server load from client load.

7. **`app/sessions/page.tsx`** and **`app/checkout/page.tsx`**
   - Already wrapped in Suspense at the page level.
   - Convert `SessionsContent` and `CheckoutContent` to use `useSuspenseQuery` for their primary queries and remove internal `isLoading` branches.

### 5.2 Remove `lib/instructors.ts` mock data

1. Add a public Convex query in `convex/instructors.ts`:

   ```ts
   export const getPublicTestimonials = query({
     args: { limit: v.optional(v.number()) },
     handler: async (ctx, args) => {
       const limit = args.limit ?? 50;
       const instructors = await ctx.runQuery(api.instructors.getPublicInstructors, {});
       const instructorIds = new Set(instructors.map((i) => i._id));
       const testimonials = await ctx.db
         .query("instructorTestimonials")
         .withIndex("by_instructorId", (q) => q.gt(q.field("instructorId"), ""))
         .collect();
       const result = [];
       for (const t of testimonials) {
         if (t.instructorId && instructorIds.has(t.instructorId)) {
           const instructor = instructors.find((i) => i._id === t.instructorId);
           if (instructor) {
             result.push({
               text: t.text,
               author: t.name,
               role: t.role,
               instructorName: instructor.name,
               instructorSlug: instructor.slug,
             });
           }
           if (result.length >= limit) break;
         }
       }
       // Shuffle deterministically-ish
       for (let i = result.length - 1; i > 0; i--) {
         const j = Math.floor(Math.random() * (i + 1));
         [result[i], result[j]] = [result[j], result[i]];
       }
       return result;
     },
   });
   ```

   > Note: if the index scan pattern above is inefficient, switch to a simple `collect()` capped by `limit` and then filter in memory; the table is small and this is a public page.

2. Add a hook in `apps/platform/lib/queries/convex/use-instructors.ts`:

   ```ts
   export function usePublicTestimonials() {
     return useSuspenseQuery(convexQuery(api.instructors.getPublicTestimonials, {}));
   }
   ```

3. Update `components/testimonials/testimonials-carousel.tsx`:
   - Replace `mockInstructors` import with `usePublicTestimonials`.
   - Remove `buildTestimonials` and `useMemo`.
   - Wrap the carousel in a Suspense boundary on the parent page (`app/page.tsx`) or inside the component using a local fallback.
   - Keep the shuffle behavior for equal exposure; move it into the Convex query or compute it once with a stable sort.

4. Delete `apps/platform/lib/instructors.ts`.
   - Verify no other imports break (`scripts/seed-instructors.ts` imports from `apps/marketing`, not from this file).
   - Run typecheck and tests.

### 5.3 Convert `DashboardContent` to TanStack Query hooks

1. Add two hooks in `apps/platform/lib/queries/use-google-calendar.ts` (new file) or extend `lib/queries/convex/use-instructors.ts` if they must live elsewhere.

   ```ts
   export function useGoogleCalendarStatus() {
     return useQuery({
       queryKey: ["googleCalendarStatus"],
       queryFn: async () => {
         try {
           await getGoogleCalendars();
           return { connected: true };
         } catch (e) {
           if (e instanceof ApiFetchError && e.status === 409) {
             return { connected: false };
           }
           throw e;
         }
       },
       staleTime: 1000 * 60 * 5,
       gcTime: 1000 * 60 * 5,
       retry: 1,
     });
   }

   export function useGoogleBookings() {
     return useQuery({
       queryKey: ["googleBookings"],
       queryFn: async () => {
         const json = await getMyBookings();
         return json.success ? (json.bookings ?? []) : [];
       },
       staleTime: 1000 * 60 * 5,
     });
   }
   ```

   - If we want them to participate in Suspense, also export `useSuspenseGoogleCalendarStatus` and `useSuspenseGoogleBookings` that call `useSuspenseQuery` with the same options.

2. Update `DashboardContent`:
   - Replace the two `useEffect` blocks with the hooks.
   - Remove `googleBookings`, `loadingGoogleBookings`, `googleCalendarConnected`, `loadingGoogleCalendar` local state.
   - Use `queryClient.invalidateQueries({ queryKey: ["googleCalendarStatus"] })` after a successful OAuth callback (when `?google_calendar=connected` is present).
   - Remove all `sessionStorage` reads/writes.

3. Update `components/settings/google-calendar-card.tsx`:
   - Replace the manual `useEffect` + `sessionStorage` cache with `useGoogleCalendarStatus`.
   - On connect/disconnect/save, invalidate the query key so the card re-fetches.
   - Keep the `isOAuthCallback` URL cleanup logic.

### 5.4 Replace `sessionStorage` cache

After §5.3, the only remaining `sessionStorage` usage in the Google Calendar flow is for OAuth callback cleanup. That is intentional navigation state, not a cache.

- Remove `lib/constants/storage-keys.ts` if no longer needed.
- Remove the `GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY` constant and its import sites.

### 5.5 Remove unnecessary `useMemo`

1. **`app/checkout/page.tsx`**
   - Replace:
     ```tsx
     const productList = useMemo(() => { ... }, [allProducts, mentorshipType]);
     const selectedProduct = useMemo(() => productList.find(...), [productList, selectedProductId]);
     ```
   - With:
     ```tsx
     const productList = mentorshipType
       ? allProducts.filter((p) => p.mentorshipType === mentorshipType)
       : allProducts;
     const selectedProduct = productList.find((p) => p._id === selectedProductId);
     ```

2. **`app/dashboard/DashboardContent.tsx`**
   - Replace:
     ```tsx
     const sortedPacks = useMemo(() => { ... }, [sessionPacks]);
     const uniqueInstructorCount = useMemo(() => { ... }, [sessionPacks]);
     ```
   - With:
     ```tsx
     const sortedPacks = sessionPacks
       ? [...sessionPacks].sort((a, b) => b.purchasedAt - a.purchasedAt)
       : [];
     const uniqueInstructorCount = new Set(sessionPacks?.map((p) => p.instructorId) ?? []).size;
     ```

3. **`components/instructor/availability-settings-form.tsx`**
   - Remove `timeZones = useMemo(() => getTimeZones(), [])` if `getTimeZones()` is a cheap lookup or already cached internally.
   - If profiling shows it is expensive, keep the memo but add a comment explaining why.

### 5.6 Fix chat component `reverse()`

1. In `components/workspace/chat.tsx`, replace the `messages` `useMemo` with a state-based chronological list.

   ```ts
   const [messages, setMessages] = useState<MessageList>([]);
   ```

2. Add a `useEffect` that merges `messagesRaw` (newest-first) into `messages` (oldest-first) without reversing the whole array every time:

   ```ts
   useEffect(() => {
     if (!messagesRaw || messagesRaw.length === 0) {
       setMessages([]);
       return;
     }
     setMessages((prev) => {
       const prevIds = new Set(prev.map((m) => m._id));
       const newMessages = messagesRaw.filter((m) => !prevIds.has(m._id));
       const existingMessages = messagesRaw.filter((m) => prevIds.has(m._id));
       // Preserve chronological order: oldest → newest
       return [...existingMessages.reverse(), ...newMessages.reverse()];
     });
   }, [messagesRaw]);
   ```

   > This is a safe merge: if `messagesRaw` grows at the end (older pages loaded), the new messages are prepended to `messages`. If `messagesRaw` grows at the beginning (new message sent), the new messages are appended.

3. If this merge logic becomes too complex or if chat histories are long, consider adding a lightweight virtualization library (e.g., `react-window`) as a follow-up. That is out of scope for this PR unless profiling proves it is necessary.

4. Update the `admin/onboardings/[id]/page.tsx` timeline `reverse()` (line 246) as a separate cleanup: the timeline is a short array, so using `[...data.timeline].reverse()` inline is acceptable. Leave it as-is or replace with a computed constant before render; this is a minor cleanup.

## 6. Verification

1. `pnpm --filter @mentorships/platform typecheck`
2. `pnpm --filter @mentorships/platform lint`
3. `pnpm test:unit` (especially the chat component tests added in PR 6)
4. `pnpm test:convex` (after adding `getPublicTestimonials`)
5. `pnpm --filter @mentorships/platform build`
6. `npx greptile@latest review`

## 7. Acceptance criteria

- [ ] `apps/platform/lib/instructors.ts` is deleted and `pnpm build` still passes.
- [ ] The landing-page testimonials carousel renders real data from Convex.
- [ ] `DashboardContent` no longer contains `useEffect` calls for `getMyBookings` or `getGoogleCalendars`.
- [ ] `sessionStorage` is no longer used for the Google Calendar not-connected cache.
- [ ] At least three pages have meaningful Suspense boundaries with skeleton fallbacks (e.g., `/instructors`, `/instructor/dashboard`, `/admin`).
- [ ] Unnecessary `useMemo` instances in `checkout/page.tsx` and `DashboardContent.tsx` are removed.
- [ ] `components/workspace/chat.tsx` no longer reverses the entire message array on every render.
- [ ] All unit, Convex, and build checks pass.
- [ ] Greptile review returns no new issues.

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `useSuspenseQuery` with `@convex-dev/react-query` throws because the returned options don't include `queryFn` | The global `queryFn` is already set in `QueryProvider`. Verify with a small test component before applying broadly. |
| Deleting `lib/instructors.ts` breaks tests or seed scripts | The only consumer is `testimonials-carousel.tsx`; `scripts/seed-instructors.ts` imports from `apps/marketing`. Audit imports first. |
| `getPublicTestimonials` returns too many rows or leaks deleted instructors | Reuse `getPublicInstructors` to filter active instructors and cap the result. |
| Chat message merge logic is wrong for new messages | Add/update the chat component test in `components/workspace/chat.test.tsx` to assert chronological order after a new message is sent. |
| Suspense boundaries hide existing error handling | Add `error.tsx` to affected routes or use `ErrorBoundary` + `QueryErrorResetBoundary` with retry. |

## 9. Follow-up PRs

- PR 8: Accessibility, UI consistency, and cleanup.
- Optional: Chat virtualization if message histories become large enough to justify a new dependency.

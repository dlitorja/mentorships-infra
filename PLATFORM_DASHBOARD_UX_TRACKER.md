# apps/platform Dashboard UX Improvements Tracker

**Scope:** Instructor dashboard, admin dashboard, and student-facing dashboard areas in `apps/platform`.
**Last updated:** 2026-07-28
**Naming rule:** `mentor` and `mentee` are forbidden; use `instructor` and `student` (only `mentorships` is allowed in UI copy).

---

## PR Plan

| PR | Theme | Priority | Status |
|---|---|---|---|
| [PR #694](#pr-694-p0-policy-link-and-button-fixes) | Policy, link, and button fixes | P0 | In progress |
| [PR #695](#pr-695-p1-navigation-and-sidebar-consistency) | Navigation and sidebar consistency | P1 | Not started |
| [PR #696](#pr-696-p1-dashboard-student-and-instructor-ux) | Dashboard, student, and instructor UX | P1 | Not started |
| [PR #697](#pr-697-p2-polish-and-accessibility) | Polish and accessibility | P2 | Not started |

---

## PR #694 — P0: Policy, Link, and Button Fixes

**Goal:** Fix forbidden words, swap internal `<a>` tags to Next.js `<Link>`, correct misleading button states, and add missing labels.

### 1. Forbidden words: hardcoded testimonials
- **File:** `apps/platform/lib/instructors.ts`
- **Lines:** 193, 197, 201, 231, 305, 313, 321, 333, 337, 376
- **Issue:** Hardcoded testimonials use `mentor` and `mentee`.
- **Fix:** Rewrite all testimonials to use `instructor` and `student`.
- **PR:** #694

### 2. Forbidden word in landing-preview testimonial
- **File:** `apps/platform/components/landing-preview/testimonials.tsx`
- **Line:** 11
- **Issue:** Hardcoded testimonial uses `mentee`.
- **Fix:** Replace with `student`.
- **PR:** #694

### 3. Forbidden word in code comment
- **File:** `apps/platform/app/api/admin/stats/route.ts`
- **Line:** 8
- **Issue:** Comment contains `revenue/mentee`.
- **Fix:** Replace with `revenue/student`.
- **PR:** #694

### 4. Google Calendar OAuth link (intentional native `<a>`)
- **File:** `apps/platform/components/settings/google-calendar-card.tsx`
- **Line:** 166
- **Issue:** `/api/auth/google` reached via native `<a>` inside `Button asChild`.
- **Decision:** Kept as native `<a>`. The `/api/auth/google` route sets a CSRF cookie and returns a cross-origin redirect to Google; a hard browser navigation is required for the OAuth flow to work correctly.
- **PR:** #694 (no change)

### 5. Google Calendar connect link (intentional native `<a>`)
- **File:** `apps/platform/components/instructor/google-calendar-status.tsx`
- **Lines:** 46, 104
- **Issue:** Same as #4.
- **Decision:** Same as #4.
- **PR:** #694 (no change)

### 6. PayPal "Coming Soon" button is misleading
- **File:** `apps/platform/app/checkout/page.tsx`
- **Lines:** 374–390
- **Issue:** PayPal option renders as a selectable payment method even when unavailable.
- **Fix:** Hide PayPal option or show a clear non-interactive "PayPal unavailable" state.
- **PR:** #694

### 7. Icon-only destructive "Purge" instructor action
- **File:** `apps/platform/app/admin/instructors/page.tsx`
- **Lines:** 236–243
- **Issue:** Permanent delete is a red icon with no text label.
- **Fix:** Add visible text or `aria-label` and confirm dialog.
- **PR:** #694

### 8. Admin "Create New Product" uses native `<a>`
- **File:** `apps/platform/app/admin/products/page.tsx`
- **Lines:** 365–371
- **Issue:** Internal link uses native `<a>`.
- **Fix:** Use `Button asChild` + `Link`.
- **PR:** #694

### 9. Recording links in student sessions (external URL)
- **File:** `apps/platform/app/sessions/SessionsContent.tsx`
- **Line:** 125
- **Issue:** View Recording link uses native `<a>`.
- **Decision:** Recording URLs are external Daily.co links, so the current `<a>` is correct. Opening in a player modal is a future polish item.
- **PR:** Deferred to P2 / player-modal UX

### 10. Recording links in instructor sessions (external URL)
- **File:** `apps/platform/app/instructor/sessions/sessions-list-client.tsx`
- **Line:** 116
- **Issue:** Same as #9.
- **Decision:** Same as #9.
- **PR:** Deferred to P2 / player-modal UX

### 11. Header error boundary uses native `<a>` for internal link
- **File:** `apps/platform/components/navigation/header-error-boundary.tsx`
- **Line:** 41
- **Issue:** Fallback header uses `<a href="/">` for internal navigation.
- **Fix:** Use `next/link` `Link`.
- **PR:** #694

### 12. Singular "Mentorship" in dashboard copy
- **File:** `apps/platform/app/dashboard/DashboardContent.tsx`
- **Line:** 341
- **Issue:** Card title reads "Get started with your mentorship".
- **Fix:** Change to "Get started with your mentorships" or "Get started with your sessions".
- **PR:** #694

### 13. Singular "Mentorship" in instructor profile
- **File:** `apps/platform/app/instructors/[slug]/page.tsx`
- **Lines:** 134, 155
- **Issue:** "1-on-1 Mentorship" and "Group Mentorships" are inconsistent.
- **Fix:** Standardize to "1-on-1 Mentorships" or "1-on-1 Sessions".
- **PR:** #694

### 14. "mentorship packages" in instructor profile
- **File:** `apps/platform/app/instructors/[slug]/page.tsx`
- **Line:** 174
- **Issue:** Empty-state uses "mentorship packages".
- **Fix:** Use "session packs" or "session packages".
- **PR:** #694

---

## PR #695 — P1: Navigation and Sidebar Consistency

**Goal:** Fix sidebar navigation inconsistencies, active-path matching, and hardcoded defaults.

### 15. Instructor sidebar inconsistent icons and labels
- **File:** `apps/platform/components/navigation/protected-layout.tsx`
- **Lines:** 43–61
- **Issue:** Some nav items lack icons; active matching is exact-path only; "Submissions" label is confusing.
- **Fix:** Add icons, use `startsWith` for subpath matching, rename "Submissions" to "Onboarding".
- **PR:** #695

### 16. Admin sidebar active path matching
- **File:** `apps/platform/app/admin/client-admin-layout.tsx`
- **Lines:** 55–56
- **Issue:** `/admin` only matches exactly.
- **Fix:** Make `/admin` active for any `/admin/*` path.
- **PR:** #695

### 17. Hardcoded instructor defaults
- **File:** `apps/platform/app/admin/instructors/create/page.tsx`
- **Lines:** 33–35
- **Issue:** Magic defaults for inventory, capacity, and max students.
- **Fix:** Extract to named constants and add helper text.
- **PR:** #695

### 18. Hardcoded default session count
- **File:** `apps/platform/app/admin/students/page.tsx`
- **Line:** 108
- **Issue:** `totalSessions` defaults to `"4"`.
- **Fix:** Add a named constant or inline helper.
- **PR:** #695

### 19. Instructor calendar hardcoded cell height and truncation
- **File:** `apps/platform/app/instructor/sessions/sessions-calendar-view.tsx`
- **Lines:** 182, 202, 219
- **Issue:** Cells are hardcoded `min-h-[80px]` and show only first 3 sessions.
- **Fix:** Add "Today" highlight, responsive height, and empty-state message.
- **PR:** #695

### 20. Instructor sessions list empty state too terse
- **File:** `apps/platform/app/instructor/sessions/sessions-list-client.tsx`
- **Lines:** 240–249
- **Issue:** Empty state has no CTA.
- **Fix:** Add "Book a session" or "View students" CTA.
- **PR:** #695

### 21. Status badge uses inline IIFE
- **File:** `apps/platform/app/admin/students/invite/page.tsx`
- **Lines:** 291–297
- **Issue:** Invitation status badge rendered via IIFE.
- **Fix:** Extract to a small helper component.
- **PR:** #695

### 23. Admin workspace creation search lacks clear button
- **File:** `apps/platform/app/admin/workspaces/create/page.tsx`
- **Line:** 204
- **Issue:** User search input has no clear/reset button.
- **Fix:** Add a clear button inside the input.
- **PR:** #695

---

## PR #696 — P1: Dashboard, Student, and Instructor UX

**Goal:** Fix empty states, remove duplicate CTAs, correct always-visible cards, and improve data presentation.

### 23. "Calendar Bookings" card always visible on student dashboard
- **File:** `apps/platform/app/dashboard/DashboardContent.tsx`
- **Lines:** 504–550
- **Issue:** Always rendered even for non-instructor students.
- **Fix:** Only show for instructors/admins or move to instructor dashboard.
- **PR:** #696

### 24. Duplicate "Quick Actions" card
- **File:** `apps/platform/app/dashboard/DashboardContent.tsx`
- **Lines:** 553–575
- **Issue:** "Browse Instructors" and "Schedule Session" duplicate the "Get started" card.
- **Fix:** Remove duplicate card or consolidate.
- **PR:** #696

### 25. "Mark reviewed" button disabled without explanation
- **File:** `apps/platform/app/instructor/onboarding/page.tsx`
- **Lines:** 211–212
- **Issue:** Disabled when already reviewed with no explanation.
- **Fix:** Add helper text or change to a read-only badge.
- **PR:** #696

### 26. Admin onboarding list empty state
- **File:** `apps/platform/app/admin/onboardings/page.tsx`
- **Lines:** 287–292
- **Issue:** Plain text empty state.
- **Fix:** Add icon, clearer message, and filter/refresh CTA.
- **PR:** #696

### 27. Product table pagination icon-only
- **File:** `apps/platform/app/admin/products/page.tsx`
- **Lines:** 486–501
- **Issue:** Previous/Next buttons are icon-only.
- **Fix:** Add text labels or `aria-label`.
- **PR:** #696

### 28. Orders table pagination icon-only
- **File:** `apps/platform/app/admin/orders/page.tsx`
- **Lines:** 472–488
- **Issue:** Same as #26.
- **Fix:** Same as #26.
- **PR:** #696

### 29. Instructor profile form uses native `<img>`
- **File:** `apps/platform/app/instructor/profile/profile-form.tsx`
- **Lines:** 400, 604
- **Issue:** Native `<img>` instead of Next.js `Image`.
- **Fix:** Use `Image` with proper `sizes` and `alt`.
- **PR:** #696

### 30. "Last session: No sessions yet" ambiguous
- **File:** `apps/platform/app/instructor/students/page.tsx`
- **Line:** 287
- **Issue:** `formatDate` returns "No sessions yet" for null dates.
- **Fix:** Add an explicit empty-state label.
- **PR:** #696

### 31. Checkout availability message not actionable
- **File:** `apps/platform/components/checkout/availability-preview.tsx`
- **Lines:** 57–63
- **Issue:** "Availability shown after purchase" is confusing.
- **Fix:** Clarify to "Instructor's calendar is not connected yet...".
- **PR:** #696

---

## PR #697 — P2: Polish and Accessibility

**Goal:** Lower-priority visual and accessibility improvements.

### 33. Admin panel subtitle "Web App" is non-descriptive
- **File:** `apps/platform/app/admin/client-admin-layout.tsx`
- **Line:** 49
- **Issue:** Sidebar subtitle adds no context.
- **Fix:** Remove or replace with "Huckleberry Admin".
- **PR:** #697

### 34. Sign Out button inconsistent
- **File:** `apps/platform/app/admin/client-admin-layout.tsx`
- **Lines:** 92–97
- **Issue:** Plain `<button>` with Tailwind classes instead of `Button` component.
- **Fix:** Use `Button variant="ghost"`.
- **PR:** #697

### 35. Instructor edit page 7-tab overflow
- **File:** `apps/platform/app/admin/instructors/[id]/edit/page.tsx`
- **Line:** 563
- **Issue:** `grid-cols-7` overflows on smaller screens.
- **Fix:** Use scrollable tab list or responsive 2-row layout.
- **PR:** #697

### 36. Backfill Images panel permanently visible
- **File:** `apps/platform/app/admin/instructors/page.tsx`
- **Lines:** 134–146
- **Issue:** Clutters the main instructor list.
- **Fix:** Collapse behind "Advanced / Maintenance" or move to settings.
- **PR:** #697

### 37. TODO in AI matching section
- **File:** `apps/platform/components/landing/ai-matching-section.tsx`
- **Line:** 19
- **Issue:** `TODO: Implement matching when backend is ready`.
- **Fix:** Implement or remove; if deferred, create a tracked issue.
- **PR:** #697

---

## Completed PRs

| PR | Description | Status |
|---|---|---|
| #692 | Consolidate instructor availability settings under `/instructor/availability` | Merged |
| #693 | Dashboard UX quick wins (calendar, navigation, booking CTAs) | Merged |

---

## Notes

- All PRs should follow the `widen-migrate-narrow` pattern only if they touch schema.
- Run `npx greptile@latest review` before opening each PR.
- Run `pnpm typecheck` and `pnpm lint` for `apps/platform` before committing.
- Re-check this tracker after each PR merges and move any newly discovered items into a future PR.

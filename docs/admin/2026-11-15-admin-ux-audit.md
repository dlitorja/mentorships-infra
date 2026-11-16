# Mentorships-Infra Admin UI — UX Audit & Fix Brief for OpenCode

> **Review status (2026-11-16).** This brief was re-verified against `origin/main` @ `1c97333` before
> implementation. Every P0 and the sampled P1s held up with exact file/line matches. Three corrections
> and four additions were found; see **Errata** at the end of this document. Read the errata before
> implementing §2, §3.1, or §5 — the prescribed fix for §2 names the wrong Convex function.
>
> **Decisions taken (2026-11-16):**
> 1. Canonical `activeStudentCount` = **distinct students with an active seat** (grace shown separately).
> 2. `/admin/instructors` is the canonical instructor surface; the dashboard widget becomes a summary card.
> 3. Work ships as UI-only and API-only PRs, never mixed (`1a`, `1b`, then the remaining batches).
> 4. Tracking lives in the Linear "Admin UX remediation" project, not in this document.

**Date:** 2026-11-15
**Repo snapshot:** `main` @ `1c97333` — `fix(platform): make a failed Convex token mint retryable, not a dead-end 500 (#1050)`. Fresh clone; re-verify paths/line numbers against current `main` before implementing — line numbers below are exact at this commit.
**Scope:** `apps/platform` admin UI only (the production app per the 2026-11-08 decision; `apps/web` / `apps/marketing` are being retired and were not audited). This is a **code audit** — no live app, Convex deployment, Stripe, or Kajabi state was queried. Findings are what the code guarantees, which for the P0s is enough: they fail deterministically for every user.
**Method:** Every admin page, its API routes, and the Convex queries behind them were read in full. Headline P0s (§1–§4) were independently re-verified against the source after the initial pass.

**Severity key:** **P0** = broken or actively misleading (wrong/empty data presented as truth, data loss, money risk). **P1** = major friction or core job information missing. **P2** = polish / consistency.

---

## TL;DR — the five systemic problems

1. **Errors are silently swallowed and rendered as empty states, everywhere.** Instructor expansion, instructors list, students list (incl. the API's `206` degraded mode), workspaces list, orders, audit logs, invitations, email-health card. An outage is indistinguishable from "no data." This is the single most repeated defect in the admin.
2. **The data relationships exist; the UI doesn't traverse them.** Instructor → students, order → product/instructor/pack, onboarding → workspace, workspace → owner/instructor detail, product → students. In almost every case the ID, the endpoint, or the enriched field already exists — the link/render was never done. Dee's dashboard complaint (§1) is one instance of this pattern, not an isolated bug.
3. **Three surfaces implement "instructor + their students" three different ways** (dashboard widget, instructors list, edit page), with different data sources, different identity conventions, and three different definitions of `activeStudentCount` (§1.4). They need to converge on one.
4. **Money and destructive actions have inverted friction.** Refunds (irreversible, Stripe/PayPal) get a thin hand-rolled modal with no context; workspace ownership transfer and making a workspace publicly accessible without auth get *no* confirmation; while a soft delete gets a dialog whose copy falsely says "cannot be undone," and routine instructor saves demand a modal dismissal every time.
5. **Several admin surfaces report a live business as empty/broken:** dashboard stats are a hard-coded zero placeholder with mismatched field names (§2), the orders status filter is silently dropped server-side (§5), the product edit form opens on a nonexistent tab (§6), and the students/instructors lists silently truncate at the first page/100 rows (§3, §4).

**Suggested order of work** is in §12 — small, separately shippable batches, P0s first.

---

## 1. P0 — Dashboard: expanding an instructor never shows students (Dee's example, root-caused)

**Symptom:** On `/admin`, expanding an instructor row in the Instructors section always shows "Students (0)" / "No students assigned yet," even for instructors with active students. The `activeStudentCount` badge in the same row can simultaneously show a non-zero number.

**The UI exists and looks correct.** `apps/platform/app/admin/admin-instructors-section.tsx` implements expansion (`InstructorRow`, expanded row at `:248-266`), `Expand All` / `Collapse All`, and a `StudentsTable` (Email / Sessions / Status / "Last Session" / Expiration). On toggle it fetches `getAdminInstructorStudents(instructorId)` (`:302-318`; client at `lib/queries/api-client.ts:1064-1071`).

**The bug is a response-shape mismatch in the API route, and it fails 100% of the time:**

1. `GET /api/admin/instructors/[id]/students` (`app/api/admin/instructors/[id]/students/route.ts:27-32`) calls `api.admin.getStudentsForAdmin({ instructorId: id, page: 1, pageSize: 100 })`.
2. `convex/admin.ts` `getStudentsForAdmin` (`:357-…`) **groups packs by student**. Its `items[]` are `{ userId, email, sessionPacks: [{ id, instructorId, instructorName, instructorSlug, totalSessions, remainingSessions, purchasedAt, expiresAt, status }] }` (grouping built at `convex/admin.ts:434-475`). There is no flat `id`, `instructorId`, `totalSessions`, `purchasedAt`, `status`, or `createdAt` on the item itself.
3. The route validates the result against a **flat** schema — `StudentSchema` requires `id, userId, email, instructorId, instructorName, instructorSlug, totalSessions, remainingSessions, purchasedAt, expiresAt, status, createdAt` (`route.ts:34-57`). `safeParse` therefore fails for every real response, and the route returns `500 { error: "Invalid students payload" }` (`route.ts:55-58`).
4. The widget catches *all* errors identically: `catch { setExpandedStudents(prev => ({ ...prev, [instructorId]: [] })) }` (`admin-instructors-section.tsx:311-317`, same pattern in `expandAll` at `:324-336`). A 500 becomes an empty array, which renders as a truthful-looking "No students assigned yet." No error is logged or shown in the UI.
5. There is **no test** covering this route (grep for the route / `getAdminInstructorStudents` across tests: only the widget and client reference it).

The sibling route `GET /api/admin/students` handles the *same* Convex query correctly — it maps the grouped shape (`sessionPacks[]` per user) in `app/api/admin/students/route.ts` (response mapping at the end of `GET`) and enriches emails via `lib/admin/student-enrichment`. The instructor-students route was evidently written against an older/assumed flat shape and never updated.

### 1.1 Fix options (pick one, in preference order)

**Option A (recommended) — rewire the route to the purpose-built Convex query.** `convex/admin.ts` `getInstructorWithStudents` (`:665-…`) already returns exactly what an expanded instructor view should show, per instructor: enrolled packs (packs that actually have a seat reservation — orphaned packs are deliberately excluded), plus `lastSessionCompletedAt`, `completedSessionCount`, `seatStatus`, `seatExpiresAt` per student. It is currently used only by `apps/marketing`, not platform. Have the route call it, adapt its output to the widget's `AdminStudent` shape (or extend the widget type), and validate against a schema that matches the real return type.

**Option B (smaller) — flatten the grouped shape in the route.** Keep `getStudentsForAdmin`, but map `items[].sessionPacks[]` → flat student rows (one row per pack, `createdAt` ← pack creation/`purchasedAt` if no better field exists) before validation, mirroring what `/api/admin/students` already does. Downside: this source counts *packs*, including packs with no seat reservation, so "students" here will disagree with the seat-based `activeStudentCount` badge — see §1.4.

Either way, also:

- **Stop swallowing the error in the widget.** Track a per-instructor error state; render "Couldn't load students — Retry" in the expanded row. Never convert a failed fetch into `[]`.
- **Add a route test** with a realistic grouped `getStudentsForAdmin` payload (or a `getInstructorWithStudents` payload under Option A) so shape drift fails CI instead of silently emptying the UI. The students list page already Zod-parses its response for exactly this reason (`app/admin/students/page.tsx:46-81`).

### 1.2 Related defects in the same widget (fix in the same batch)

- **"Last Session" column is mislabelled.** The header says *Last Session* (`admin-instructors-section.tsx:85`) but the cell renders `purchasedAt` (`:100`). Rename to "Purchased," or (Option A) render the real `lastSessionCompletedAt`.
- **Expand All is serial and unrecoverable.** `expandAll` awaits one fetch per instructor in a `for` loop (`:320-338`) — N sequential round-trips, no progress state. Fetch in parallel (`Promise.all`) or, better, have the endpoint/rendering use React Query per row so expansion is cached per instructor instead of hand-rolled `useState` maps.
- **Rows can't be individually collapsed while "Expand All" is active.** Rendering is `isAllExpanded || expandedInstructorId === id` (`:382`), but `handleToggleExpand` in all-expanded mode only mutates `expandedInstructorId` (`:293-296`) — clicking a row does nothing visible.
- **Loading state is dead code.** `_loadingStudents` is set but never read (`:290`); the spinner keys off `students === null`, which is also the pre-fetch state, so states are conflated.
- **Identity is email-only.** The row headline is `instructor.email` (`:181`); the list endpoint already returns `name`/`displayName`/`slug` (`app/api/admin/instructors/route.ts:72-88`). Show name first, email second (repo convention), and link the row/name to `/admin/instructors/[id]/edit` — currently there is no path from the dashboard widget to the instructor's edit page at all.
- **Inline inventory editing is undiscoverable.** Three number inputs live in the row, but the single Save button sits in the *Max Students* column (`:186-245`); editing 1:1 inventory gives no hint where Save is, no dirty highlight on the changed field, and no success feedback (only an inline error). The 1:1/group inputs stop row-click propagation on the input only; the Max Students cell stops it on the whole cell — inconsistent.
- **No search / filter / sort** in the widget, and the list is the endpoint's default limit (100) with no indication of truncation.

### 1.3 The instructors *list page* doesn't have the feature at all

`/admin/instructors` (§3) has no expansion, no student counts, and never calls the students endpoint — it uses a different, poorer data source. The capability Dee expects "in the admin dashboard" should live on the instructors page as the superset surface; §3 and §12 cover the convergence.

### 1.4 "Active student count" has three definitions — pick one

| Source | Definition |
|---|---|
| `convex/instructors.ts` `getInstructorsForAdmin` (`:1641-1672`) — used by the dashboard widget list | Count of `seatReservations` **rows** with `status === "active"` for the instructor (collects *all* seat reservations globally, then filters in memory) |
| `convex/admin.ts` `getInstructorsWithStatsForAdmin` (`:574-…`) | Count of **distinct `sessionPackId`s** among active seats, via `by_instructorId_status` |
| `convex/admin.ts` `getInstructorWithStudents` (`:665-…`) | `activeStudentCount` = active seat **rows**; `students[]` = packs that have *any* seat (active, grace, or released) |
| `convex/admin.ts` `getStudentsForAdmin` (`:357-…`) | Not seat-based at all: all `sessionPacks` for the instructor, grouped by user |

Decide the canonical meaning (recommendation: **distinct students with an active seat**, with grace shown separately), implement it in one Convex query, and use it for the badge, the expanded list header count, the instructors page, and the onboarding capacity checks — capacity decisions are being made against these numbers.

---

## 2. P0 — Dashboard home: stat cards are a hard-coded placeholder

`app/admin/page.tsx`; `app/admin/admin-stats.tsx`; `app/api/admin/stats/route.ts`; `app/admin/email-health-summary-card.tsx`.

- **The stats API returns zeros, unconditionally, and says so:** `app/api/admin/stats/route.ts:5-24` — "Returns admin dashboard statistics placeholder… Currently returns zero values," returning `totalActiveMentees: 0, revenueThisMonth: 0, …`.
- **The field names don't even match the client.** Route returns `totalActiveMentees` / `hasMenteeData`; the client type expects `totalActiveStudents` / `hasStudentData` (`lib/queries/api-client.ts:1623-1632`, consumed at `admin-stats.tsx:25-34`). Net effect in production, regardless of business state: **Active Students permanently reads "No students yet" (dimmed), Revenue (This Month) $0.00, Revenue Change "No prior data," Revenue (This Year) $0.00.** (The `mentee` naming also violates the repo's own naming rule.)
- A real implementation exists unused: `convex/users.ts:1334` `getAdminStats`. **Fix:** wire the route to it, align field names to the client type, delete the placeholder. Until wired, hide the cards rather than render fake zeros.
- **No "needs attention" queue.** Nothing surfaces pending/failed onboardings, failed payments, expiring invitations, or partially-refunded orders — the reasons an admin opens this page. Quick Actions (`page.tsx:60-70`) is only Create Product / View Orders / Manage Products — no Invite Student, Create Instructor, Onboardings, or Workspaces. Add an attention strip fed by counts with deep links.
- **One failing widget takes down the whole dashboard.** `AdminStats` uses `useSuspenseQuery` (`admin-stats.tsx:17-21`) under a `Suspense` boundary that handles loading only (`page.tsx:46-48`); a stats error propagates to `app/admin/error.tsx` and replaces the entire dashboard. Add per-widget error boundaries with an inline "Stats unavailable — Retry" card.
- **Email Health summary card is invisible when healthy *and* when broken.** It returns `null` with no token (`email-health-summary-card.tsx:17`), `null` on any fetch error (silent `catch {}`, `:26-28`), and `null` when no red/denied domains (`:33`). "Email is fine" and "the health check is down" look identical. Render a small "Email health unavailable" card on error; ideally a quiet green "Email healthy (7d)" state otherwise. Also: red-domains list caps at 3 with no "+N more" (`:50`); warning/yellow domains never surface (`:31` filters `severity === "red"` only).
- **Stat semantics are thin even once wired (P2):** all three revenue cards use the same `ArrowUpDown` icon (`admin-stats.tsx:42,54,87`); "Revenue" never says gross vs net-of-refunds or which payment statuses count; currency is hard-coded USD (`:9-14`). Label the definition in a subtitle/tooltip.

*Good:* skeleton loaders (`page.tsx:10-36`); the honest-empty copy pattern in `admin-stats.tsx` is the right instinct — it's just being fed fake data.

---

## 3. Instructors list, create, and edit

### 3.1 List — `app/admin/instructors/page.tsx`

Job: triage the whole roster — who's active/listed, full vs has capacity, students at risk — and jump to students/products/orders/edit.

- **[P1] No operational data, although the API already returns it.** Columns are only Name, Slug, Specialties (first 3 + `+N`), Status, Created, Actions (`page.tsx:200-285`). The page fetches via Convex `useAllInstructors()` (`page.tsx:56`; `lib/queries/convex/use-instructors.ts:135-141`, capped at 100) and never calls `GET /api/admin/instructors`, which already returns `oneOnOneInventory`, `groupInventory`, `maxActiveStudents`, `activeStudentCount`, `productActiveOneOnOne/Group` per instructor (`app/api/admin/instructors/route.ts:72-88`). Add Students (`active/max` + utilisation), inventory, and product-active columns. Revenue/last-session don't exist in either source — new backend field, file separately, don't fake it.
- **[P1] No expansion, no students, no cross-links** — see §1.3. Add the expandable student row here (reuse the fixed endpoint from §1), link student emails to the students list filtered by email, and add row links to products/orders filtered by instructor once those pages accept a filter param.
- **[P1] Email is searchable but never displayed; `isListed` is invisible.** `email` is in the type and search predicate (`page.tsx:35,103-108`) but there is no Email column — you can't confirm which row your email search matched. `isListed` isn't in the row type at all; "active but unlisted" vs "active and public" is indistinguishable. Add email as a muted second line under Name; split Status into Active/Inactive and Listed/Unlisted chips.
- **[P0] Load failure renders as an empty roster.** Only `{ data, isLoading, refetch }` are destructured (`page.tsx:56`); on failure the memoised list is `[]` and the UI says "No instructors found. Add one" (`:186-196`). An admin could re-add existing instructors during an outage. Render a distinct error state with Retry.
- **[P1] "Show inactive" silently also reveals deleted and incomplete records, unlabelled.** Default filter is `isActive !== false && !deletedAt && (name || slug)`; checking the box returns the list *unfiltered* (`page.tsx:96-100`), and the badge still only knows Active/Inactive (`:233-244`) — a soft-deleted instructor reads as merely "Inactive." Replace with a status filter (Active / Inactive / Deleted / All) and a distinct "Deleted" badge.
- **[P1] No sort, no pagination, no count — hard 100 cap.** Only a muted "(Showing up to 100 instructors)" (`:180-182`). Beyond 100, the tail is unreachable except by search. Show "N of M," add Name/Created sort, paginate or virtualise.
- **[P1] The only delete is the irreversible one.** Row delete calls `deleteAdminInstructor(id, true)` — hard delete (`page.tsx:58-63`) with a permanent-delete dialog (`:291-327`), although the API defaults to soft delete and deactivation exists via edit. Default the row action to Deactivate; move hard delete to an overflow menu, ideally only for already-inactive rows.
- **[P2] A one-off migration tool crowds the roster.** The collapsible "Backfill Images to Convex Storage" panel is the first card on the page (`page.tsx:124-156`). It's well-built (dry-run preview, write-confirmation checkbox, JSON report — `_components/backfill-images-panel.tsx:143-177,214-228`) but belongs in a Tools/Advanced area; leave at most a link.

*Good:* debounced search; `+N` specialty overflow; public-profile link with `aria-label`; hard-delete dialog surfaces server errors inline.

### 3.2 Create — `app/admin/instructors/create/page.tsx`

- **[P0] Invitation outcome is discarded.** `POST /api/admin/instructors` returns `invitationSent` / `invitationError` (`app/api/admin/instructors/route.ts:308-355`); the page reads only `createRes.instructor.id` (`create/page.tsx:94-97`) and navigates to the list. Creation can "succeed" while no invitation was ever sent (the API creates a placeholder `userId = admin-<slug>` when no Clerk user matches the email). Consume both fields; land on the new instructor's **edit** page with a banner: "Created — invitation sent to X" or "Created — invitation FAILED: … (resend from Basic Info)."
- **[P0] Profile-image upload failure is swallowed.** `try { await uploadInstructorImage(form) } catch { /* Non-fatal… */ }` (`create/page.tsx:102-110`) — the admin is never told and lands on the list believing the image is set. Keep it non-fatal; report it in the post-create banner.
- **[P1] Create is an unsignposted stub of edit.** No specialties/background, socials, portfolio, or testimonials at create; nothing says so or routes the admin onward. Cheapest fix: success lands on Edit with a "Finish the profile" checklist (Images → Tags → Socials).
- **[P1] Slug is silently overwritten and never pre-validated.** Every name keystroke regenerates the slug (`:52-58`), clobbering a manual correction; manual edits aren't normalised; uniqueness is only a post-submit server error. Stop regenerating once the slug is manually touched, normalise on blur, debounce an availability check.
- **[P2]** Email looks optional but is effectively required for connection — add helper text. Discord validation errors while typing and disables submit with no explanation near the button (`:187-191,377`) — validate on blur/submit. Inventory fields silently fall back to defaults (3/2/10) on NaN (`:83-85`). No unsaved-changes guard on Cancel/back (`:369-376`).

*Good:* inventory defaults are stated in the card copy (`:263-266`); Kajabi URL fields reveal only when the toggle is on; live public-path preview for the slug.

### 3.3 Edit — `app/admin/instructors/[id]/edit/**`

Eight tabs (Basic Info, Images, Tags, Social Links, Inventory, External Checkout, Testimonials, Results) over one shared `formData`, one global Save, and a modal success dialog (`edit/page.tsx:155-277`). Testimonials/Results CRUD immediately via separate mutations.

- **[P0] Unsaved edits in other tabs can be silently destroyed by a testimonial/result/invitation refetch.** `useInstructorForm` resets the *entire* form from server data in a `useEffect` on every `data` change (`hooks/use-instructor-form.ts:36-62`). Testimonial/result mutations `refetch()` on success (`hooks/use-testimonials-and-results.ts:24-65`), and the invitation hook invalidates the same `["instructor", id]` query immediately and again after 15 s (`hooks/use-send-instructor-invitation.ts:42-53`). Sequence: edit Bio (unsaved) → add a testimonial → refetch lands → effect overwrites `formData` → bio edit gone, no warning. **Fix:** hydrate only on first load (guard with a ref / key on `instructorId`), or split testimonials/results out of the detail query. This is the highest-priority fix in this section.
- **[P0] Kajabi "Verify URL" cannot verify anything.** `verifyUrl` fetches with `mode: "no-cors"` and returns `{ valid: true, message: "URL is reachable" }` whenever the promise resolves (`sections/KajabiSection.tsx:24-42`). An opaque `no-cors` response resolves for 404s and error pages alike — a green-light generator for the URLs that decide where money is sent. Verify server-side with a real HEAD/GET + status, or remove the button and keep "Open URL."
- **[P1] No students/products/orders/workspaces tab.** The detail endpoint returns profile + testimonials + results only; no tab consumes the (fixed, per §1) students endpoint. An admin editing capacity can't see a single student from here. Add a read-only Students tab (email, remaining/total, status, expiry) plus links to the instructor's products/orders. Also surface `activeStudentCount` next to `maxActiveStudents` in Inventory (next item).
- **[P1] Inventory is edited blind.** `InventorySection` shows three bare numbers (`sections/InventorySection.tsx:22-68`) with silent clamping (empty ⇒ 0, empty max ⇒ 10, >999 ⇒ 999). The detail GET doesn't return `activeStudentCount`, so "Max: 10" gives no hint the instructor has 9 — or 14. Extend the detail response (the list endpoint already computes it), render "N active" beside Max, and warn (don't block) when lowering Max below current active.
- **[P1] Two contradictory save models, neither labelled.** Profile tabs are save-on-click; Testimonials/Results delete *immediately* on click with no confirmation and no undo (`sections/TestimonialsSection.tsx:48-56`; `sections/StudentResultsSection.tsx:47-58`). Nothing tells the admin which model a tab uses — deleting a testimonial while believing "I just won't save" permanently removes public content. Add a confirm dialog for those deletes and a one-line note: "Changes here apply immediately."
- **[P1] No dirty state or unsaved-changes warning; Save is always live.** No `beforeunload`/router guard/dirty flag anywhere in the edit tree; Back (`edit/page.tsx:150-155`) discards silently; Save is enabled when pristine (`:165-175`). Compute `isDirty` against the hydrated snapshot; disable Save when pristine, show "Unsaved changes" when dirty, confirm on navigation while dirty.
- **[P1] Every routine save demands a modal dismissal.** `useUpdateInstructor.onSuccess` opens `SuccessDialog` for *every* save, including a one-word tagline fix (`hooks/use-update-instructor.ts:29-43`; `dialogs/SuccessDialog.tsx`). Replace the routine case with a toast / inline "Saved · time" in the header; keep the modal only when `productsDeactivated` is present (partial Stripe failures genuinely need it).
- **[P1] One invalid field on a hidden tab blocks the whole save, invisibly.** Header Save is `disabled={… || isDiscordUrlInvalid}` (`edit/page.tsx:165-172`), computed from a Basic Info field. On the Inventory tab the admin sees a dead Save with no reason. Don't disable globally: on Save click, switch to the offending tab, focus the field, show the error; add error dots to tabs containing invalid fields.
- **[P1] "Instructor ID" select is mislabelled and unexplained.** The Basic Info dropdown labelled "Instructor ID" (`sections/BasicInfoSection.tsx:214-235`) writes `formData.instructorId`, which the API maps to `legacyInstructorRef`. Options render `email || instructorId`, never the display name (although `displayName` is in the response schema, `edit/types.ts:131-143`). An admin can re-point this link with no confirmation and no prose about what it does. Rename to "Linked legacy instructor record," render `displayName (email)`, explain what linking affects, confirm on change — or move it to an Advanced/Danger block.
- **[P1] Load error is reported as "Instructor not found."** The query destructures no `error` (`edit/page.tsx:55-59`); any 500/auth/network failure falls into `if (!data)` → "Instructor not found." (`:136-146`). Branch on `error` with message + Retry; reserve "not found" for a genuine empty result.
- **[P2] Wizard Back/Next chain is broken and skips a tab.** Tab order: Basic → Images → Tags → Social → Inventory → Kajabi → Testimonials → Results (`edit/page.tsx:186-193`), but Inventory's Next jumps to Testimonials, skipping Kajabi (`sections/InventorySection.tsx:74-75`), and Testimonials' Back jumps to Social, skipping Inventory *and* Kajabi (`sections/TestimonialsSection.tsx:65-67`). Fix the two jumps — or drop Back/Next entirely; tabs are directly clickable and the wizard buttons imply a commit model that doesn't exist.
- **[P2] Header identifies the instructor by slug path, not by person.** H1 is generic "Edit Instructor"; subtitle is `/instructors/{slug}` as plain text (`edit/page.tsx:158-163`) — not a link, though the list page has a working public-profile link. No avatar or Active/Listed/Connected chips. Make H1 the instructor's name, subtitle a clickable public URL + status chips.
- **[P2] Tags section duplicates its own selection UI** — preset toggles, then the same values again as removable chips below (`sections/TagsSection.tsx:42-117`). Keep the preset row; render chips only for custom (non-preset) tags.
- **[P2] Smaller items:** Social Links has no validation or handle-vs-URL guidance (`sections/SocialLinksSection.tsx:23-33`). Testimonials/Results are add-only — a typo means delete + re-add, losing the date. Deactivation consequences (active-students block, Stripe product dialog — both handled well in `hooks/use-update-instructor.ts:44-55` and `dialogs/ProductDeactivationDialog.tsx`) are discovered only *after* attempting save; ticking "Active" off should hint at them in advance. Images is the strongest section (drag-reorder *and* button fallback, position numbers — `sections/ImagesSection.tsx:88-191`) — but note its remove is local-until-save while Student Results remove is immediate: same gesture, opposite semantics.

*Good:* the Clerk invitation block is the best flow in this cluster — status badge (Connected / Not Connected / No Email), invite disabled with a reason when the email is unsaved, an explicit save-first warning, and a confirmation dialog naming the *saved* address (`sections/BasicInfoSection.tsx:52-66,118-153,240-271`). Clerk ID uses `ClerkUserIdCell` with a dashboard link, correctly secondary to name/email (`:154-163`).

---

## 4. Students list and invite

### 4.1 List — `app/admin/students/page.tsx`

Job: find a student fast; see who they study with, sessions remaining, what's expiring/depleted; fix entitlements; get to instructor/workspace/order.

- **[P0] Students beyond the first page are unreachable.** The API is paginated (`page`/`pageSize`, default 20, max 100, returns `total` — `app/api/admin/students/route.ts`, `listStudentsQuerySchema`), but the page's client only forwards `search` (`students/page.tsx:74-81`; `lib/queries/api-client.ts:1215` signature is `{ search, includeInactive }` — no page params), no pager exists, and the header misreports page length as the result count: "Showing {students.length} results" (`students/page.tsx:197`), ignoring the parsed `total` (`:65-71`). Thread `page`/`pageSize`/`total` through; render "Showing 1–20 of {total}" with prev/next or load-more.
- **[P0] When email is missing, the headline *is* the raw Clerk ID.** `primaryLabel = s.email || s.userId || "Unknown email"` (`students/page.tsx:140-142`), rendered as the `font-medium` headline (`:225`) — violating the repo convention that a Clerk ID is never the primary identifier. (The second line — small, mono, muted, labelled "Clerk ID"/"Internal ID" with a debugging tooltip, `:226-235` — is exactly right; keep it.) Root cause: the API returns **no name field at all** (response maps only `userId`/`email`/`sessionPacks`), so email is the only human identifier available. Durable fix: add `name` to the API response and render name first, email second; interim fix: headline falls back to "Student (no email on file)."
- **[P1] The page promises name search/display it can't deliver.** Subtitle "Use search to filter by name or email"; placeholder "Search by name or email" (`:182,199-207`). No name is ever displayed, so a name match can't be confirmed as the right person. Fix with the name field above, or change the copy to "Search by email" until then.
- **[P1] No student detail view exists; every row is a dead end.** `app/admin/students/` contains only `page.tsx` and `invite/` — no `[userId]` route. Rows aren't clickable; pack badges render `instructorName || instructorId` as plain text (`:238-244`) although `instructorSlug` is in the data and unused. Minimum: link the instructor name in each badge to `/admin/instructors/<instructorId>/edit` (the ID is present, `:36`). Proper fix: a student detail page (packs, session history, workspaces, orders) — much of the data plumbing already exists (next item).
- **[P1] A whole session-count API is unsurfaced, and "sessions" means two things.** `app/api/admin/students/[userId]/session-count/route.ts` implements full CRUD (adjust/set with notes) and `[userId]/sessions/route.ts` implements pack creation; the page uses only the latter (Add Sessions). An admin cannot view/adjust/annotate per-instructor session *counts* or see any grant history, and the packs-vs-counts vocabulary collision is explained nowhere. Surface both in the Add Sessions dialog / a student detail view — or, if counts are legacy, say so and hide them deliberately.
- **[P1] Rich API filters exist; the UI offers only free text.** The endpoint accepts `instructorId`, `status` (active/depleted/expired/refunded), expiry/purchase ranges, `remainingMin/Max`. None is exposed. The highest-value queries — "who's depleted?", "who expires this month?", "everyone with Instructor X" — are impossible (and scrolling doesn't work either, per the pagination P0). Add Status and Instructor selects (instructor data is already fetched on this page for the dialog, `:83-92,117-120`).
- **[P2] Pack status is encoded by colour alone.** Status drives only the badge variant (`:171-180,239-242`); the status word isn't in the badge text, there's no legend, and `purchasedAt` (in the data) is never shown. Badge text should read e.g. "Instructor · 2/4 left · Expired · expires 12 Jan."
- **[P2] Empty/error states don't help the next action.** Error is a bare "Failed to load students" with no retry (`:215-216`) — and the API's degraded mode returns `206` with an empty list on Convex errors (`app/api/admin/students/route.ts`, `GET` catch), which this page presents as a truthful "No students found" (`:217-218`). Distinguish error (message + Retry), no-matches (echo query + Clear), truly-empty (Invite CTA); surface `206` as a "partial data" banner.
- **[P2] Add Sessions dialog loses context and hides risk.** It doesn't show the student's existing packs (visible in the row behind it), gives no duplicate-pack warning, and its instructor select includes inactive instructors unmarked (`fetchInstructors` loads `includeInactive: true`, `:83-92`; options render `displayName || email || instructorId` with no status). Add the current packs to the dialog top, badge inactive instructors, and end with an explicit confirm line ("Grant 4 free sessions with X, expiring Y?") — the "without payment flow" note (`:267-269`) is a good start but too weak for a free-comp action. Success is only dialog-close + refresh (`:124-133`); add a toast naming what was granted.
- **[P2] Pending invitations are disconnected from this page.** Resend/cancel exist and are correctly wired — on `/admin/students/invite`. From the list there's no indication someone is invited-but-not-joined; invited students simply don't appear here. Add a "Pending invitations (N) →" link/count near the Invite button.

*Good:* debounced search; Add Sessions keeps its mutation error *inside* the dialog (`:134-136,323-325`); the ID line's labelling/tooltip is a model of the Clerk-ID convention; the list response is Zod-parsed so shape drift fails loudly (`:46-81`).

### 4.2 Invite — `app/admin/students/invite/page.tsx`

Two modes (Invitation only / Full onboarding), invite form, and a status-filtered invitations list with Resend/Cancel. (The Full onboarding form itself is §8.3.)

- **[P1] Sending an invitation produces zero success feedback.** `createMutation.onSuccess` invalidates the list and clears the form — nothing else (`:150-155`). No toast, no "Invitation sent to X," no `isSuccess` rendering anywhere. The only evidence is a new row *if* the current filter happens to be Pending. Double-sends are the predictable result. Add a success banner/toast naming recipient + instructor + expiry, kept until dismissed.
- **[P1] The invitations list has no pagination, search, or sort — despite a paged API type.** `InvitationsResponse` carries `total/page/pageSize` (`:34-39`); none is used; every matching invitation renders (`:352-419`). The status filter also omits **Cancelled** (`:331-334`: Pending/Accepted/Expired/All) — cancelled invitations are findable only inside "All." Use the paged response (or Load More), add email search, add the Cancelled filter.
- **[P1] No error state for the list or the instructor dropdown.** Both queries destructure only `data`/`isLoading` (`:143-146,273-276`). If the invitations fetch fails, the page falls into the list branch and renders an empty list — not even "No invitations found." If instructors fail to load, the select is silently empty, blocking the form's primary action with no explanation. Render `isError` + Retry for both.
- **[P2] Inconsistent confirmation + blunt busy state.** Cancel uses `window.confirm` (good copy; `:390-394`, with a comment at `:383-389` admitting a styled dialog is a follow-up) while Resend — which revokes the prior Clerk invite and mints a new link (`:278-281`) — fires with no confirmation. One shared `isBusy` (`:319`) disables *every* row's buttons during any single action, although spinners are correctly per-row (`:371,406`). Use the shared `Dialog` for cancel; confirm resend when it invalidates a live link; disable only the acting row.
- **[P2] Row information is thin for follow-up work.** No sent/created date (only "Expires: {date}", date-only, `:358`), no accepted-at, instructor name unlinked, no last-resent indicator. An admin chasing "it expired" can't see when it was sent or resent. Add Sent + Expires (with time) and link the instructor.
- **[P2] Mode toggle gives no guidance.** "Invitation only" vs "Full onboarding" (`:105-135`) — the difference is learnable only from each card's description after switching (`:181-183` vs `:248-252`). Add one line under the toggle: "Use Full onboarding when the student already paid elsewhere; Invitation only for prospective students."

*Good:* terminal states are deliberately inert with reasoning documented (`:312-317`); cancel genuinely revokes the Clerk invite server-side (`:293-299`); specific email validation (`:163-172`); resend/cancel errors surface inline (`:340-344`); per-row `aria-label`s.

---

## 5. Orders and refunds

`app/admin/orders/page.tsx`; `app/api/admin/orders/route.ts`; `app/api/admin/refunds/route.ts`. Job: answer "what did this student buy, from which instructor, did it fulfil, and can I refund some/all of it safely?" — then refund with confidence and proof. The refund **API** is genuinely the strongest code in this audit (server-side remaining-refundable cap, Stripe idempotency key, PayPal path, bookkeeping mutation — `refunds/route.ts:86-222`). The UI around it is not.

- **[P0] The Status filter does not work — it's silently dropped server-side.** The UI sends `status` (`orders/page.tsx:241`; `lib/queries/api-client.ts:1331-1335`), but the route schema accepts only `page`/`pageSize` (`app/api/admin/orders/route.ts:8-11`) and the Convex query has no status argument (`convex/orders.ts:84-88`). Zod strips the unknown key, so selecting "Refunded" returns the same unfiltered list, paginated as if it were the filtered total. An admin reconciling refunds will draw wrong conclusions. Add `status` (and `search`) to the route + Convex query (a `by_status` index already exists, `convex/schema.ts:293`) and filter *before* paginating.
- **[P0] Search only searches the 20 rows on the current page.** `handleSearch` just resets the page (`orders/page.tsx:257-260`); filtering is in-memory over the fetched page (`:262-268`). Searching for a customer on page 3 returns "No orders yet" — while the footer still reports the *server* total (`:441-446`), so both results and count mislead. Make search server-side by email/order ID/payment ID (Students already does this via API), debounce it.
- **[P0] An order shows no product, instructor, or fulfilment state — the three things a refund decision needs.** Row/API carry only `userId/userEmail/status/provider/totalAmount/payments` (`orders/page.tsx:18-36`; `orders/route.ts:47-66`). No product title, no instructor, no session-pack / sessions used vs remaining, no workspace link; `userId` is fetched and never rendered or linked. The linkage exists (`sessionPacks.paymentId`, `convex/schema.ts:272`) — it's never joined. A "full refund" after 3 of 4 sessions were delivered looks identical to one before any session. Join and render Product, Instructor, pack status + sessions used/remaining; link Customer → student; add a row-expand or detail view with payments, prior refunds, and the linked workspace.
- **[P1] Errors are swallowed into a fake empty state.** `fetchOrders` catches everything into `setOrders([]); setTotal(0)` (`orders/page.tsx:245-248`) → "No orders yet / Orders will appear when customers make purchases" (`:336-342`) during an outage. Copy the Products list pattern instead (visible error banner, `products/page.tsx:367-371`) with Retry.
- **[P1] Refund modal: insufficient confirmation for an irreversible money action.**
  - No context: only truncated order ID + order total (`orders/page.tsx:126-128`) — not the email being refunded, not what they bought.
  - "Full Refund" is mislabelled after a prior partial: the API refunds the *remainder* (`refunds/route.ts:112-117`), but the modal never shows already-refunded vs remaining for the full path (only the partial path shows a max, `:169-171`).
  - No consequence copy: nothing says whether sessions/workspace access are revoked, kept, or must be handled manually — and no link to where you'd do that.
  - Partial amount has no client validation: no `min`, not `required` (`:160-168`) — empty/0/negative round-trips to a server error.
  - Only `payments[0]` is ever refundable (`:91`; table `:359`); multi-payment orders silently expose just the first payment.
  - Hand-rolled overlay (`:123`): no Escape/backdrop close, no focus trap — unlike the shared `Dialog` used for product delete.
  - On success the modal just closes and refetches (`:270-273`): no confirmation of amount/provider refund ID, although the API returns both (`refunds/route.ts:224-237`).
  - **Fix:** rebuild on `Dialog`; header shows email + product + instructor; summary block (paid / already refunded / this refund / remaining); explicit consequence copy with a link to session handling; validate `0 < amount ≤ maxRefund`; per-payment Refund actions; show the result inline (amount + provider refund ID) before dismissing.
- **[P1] No refund history or audit trail in the UI.** Reason/custom reason are accepted (`refunds/route.ts:20-26`) but never displayed afterwards; no refunds list, no per-order timeline, and refunds don't appear in Audit Logs (§9.1). After a *partial* refund the order stays `paid`, and the table never renders `payments[].refundedAmount` although the API returns it (`orders/route.ts:64`) — so even the status signal is absent. Add a "Refunded $X of $Y" sub-line/badge per row and a refund-history section on an order detail view (date, amount, reason, admin, provider ID).
- **[P1] The customer refund email undermines trust.** It hard-codes `instructorName = "Your Instructor"` and addresses the student by their email address as their name (`refunds/route.ts:194,197`). Resolve the real instructor name via the session pack/product and the user's name.
- **[P2] Stripe deep link is malformed in production.** `orders/page.tsx:395` builds `https://dashboard.stripe.com/${env === "production" ? "" : "test/payments/"}${providerPaymentId}` — in production the `payments/` segment disappears, producing `dashboard.stripe.com/<pi_…>`. It also decides test-vs-live from a client-side `NEXT_PUBLIC_VERCEL_ENV`. PayPal's link (`:405`) goes to the generic activity page, not the transaction. Build the URL server-side or from one tested helper: `dashboard.stripe.com/{test/}payments/{id}`.
- **[P2] Smaller frictions:** copy-ID button exists only for PayPal rows and gives no "Copied" feedback (`:71-73,367-375`); status text renders raw/lowercase in the badge (`:385-387`); `completed` is styled as paid (`:58-60`) but is a *payment* status, not an order status (`convex/schema.ts:286` vs `:302`) and isn't a selectable filter; no sort, date-range filter, or CSV export — orders are the finance record, so export is core, not nice-to-have; pagination is prev/next only (`:447-467`). Empty state conflates "nothing exists" with "filter hid everything," with no Clear Filters (also Products, §6).

*Good:* server-side refund caps + idempotency (`refunds/route.ts:98-152`); refund-email failure is logged but doesn't fail the refund (`:220-222`); pagination reports "Showing X to Y of Z" (`orders/page.tsx:443-446`).

---

## 6. Products

`app/admin/products/page.tsx`; `products/create/page.tsx`; `products/[id]/edit/page.tsx`; `products/_components/product-form.tsx` + `sections/*`, `hooks/use-product-mutations.ts`, `ResultCard.tsx`. Job: create/maintain what's sellable and know what an edit does to live checkout and existing buyers. This cluster has the best error handling in the admin — and two P0s anyway.

- **[P0] Edit mode opens on a tab that doesn't exist — the form isn't rendered until the admin clicks a tab.** `product-form.tsx:34` initialises `activeTab` to `"edit"` when `mode === "edit"`, but the only tab values are `"create-new"` and `"import-stripe"` (`:123-126` triggers; `:129,219` contents). No `TabsContent` matches on edit load. One-line fix: initialise to `"create-new"` in both modes (the trigger label already switches to "Edit Product," `:124`).
- **[P0] Create success throws away the result the UI was built to show.** `use-product-mutations.ts:19-22`: create's `onSuccess` immediately `router.push("/admin/products")`. The rich `ResultCard` — Stripe/PayPal product & price IDs, dashboard links, "Use this ID for checkout" (`ResultCard.tsx:74-159`) — is therefore unreachable for creates (it renders only for edit/import). The admin loses the checkout ID at exactly the moment they need it. On create, show the ResultCard (its "Create another" / "View all" buttons already exist, `:161-168`).
- **[P1] The form silently auto-assigns the first instructor.** `product-form.tsx:91-98`: once instructors load, if none is selected the first is auto-selected. An inattentive submit attributes a product (and its revenue) to whoever sorts first, with no visual cue. Require an explicit selection — the submit-disabled reason already lists "Instructor" (`:185`); let it do its job.
- **[P1] No way to activate/deactivate a product.** The list filters and badges on `active` (`products/page.tsx:353-362,455`), but the form has no `active` field at all (no occurrence in `product-form.tsx` or any section) and the edit page doesn't pass it through (`edit/page.tsx:126-138`). The only lifecycle action is Delete. Add an Active toggle to the form + a quick toggle in the list row.
- **[P1] No commercial context in the list.** No sales count, revenue, active students, or linked orders per product; instructor name is plain text, unlinked (`products/page.tsx:435`); the product title isn't clickable (only a small "Edit" link, `:461-466`). "Can I change/delete this safely?" requires hunting through Orders — which (§5) doesn't show products either. The loop is broken in both directions. Add Students/Sales columns (data exists via sessionPacks/orders), link instructor → instructor edit, title → edit, and show "N active students" inside the delete dialog.
- **[P1] Delete dialog understates its blast radius.** It lists Stripe archival steps (`products/page.tsx:527-531`) but says nothing about existing students/packs on the product, PayPal (only Stripe is mentioned; only `stripeProductId` shown, `:536`), or whether past orders remain refundable. No success feedback after deletion (dialog closes, list refetches, `:186-189`). Include active-pack/student counts and a PayPal line; block or loudly warn when active students exist; confirm completion with a toast.
- **[P1] Create/Edit dead-end on instructor-load failure.** Create renders a lone red box with no retry and no way forward (`create/page.tsx:55-65`); edit couples product + instructors in one `Promise.all`, so an instructor hiccup makes a good product uneditable, again with no retry/back (`edit/page.tsx:58-61,98-109`). "Product not found" (`:111-120`) is the same dead end. Decouple the fetches; degrade the selector inline with Retry; add Back + Retry to error/not-found states.
- **[P1] "Import from Stripe" tab is present while editing.** `product-form.tsx:121-127,219-226` shows it in edit mode too; importing creates a *different* product while the admin believes they're editing this one, and import success (`use-product-mutations.ts:82-87`) carries no product ID or link. Hide the tab in edit mode; on import success, link to the new product's edit page.
- **[P2] Price-change consequences are computed but never shown.** The update result carries `changes: { priceChanged, newStripePriceId, oldStripePriceId }` (`_components/types.ts:56-60`; populated at `use-product-mutations.ts:63`), but `ResultCard` never renders `changes`. Render "Price changed: old price archived, new price … created; existing packs unaffected" when `priceChanged`.
- **[P2] Dead/misleading form fields.** `currency` is in defaults and submitted (`product-form.tsx:53,72`) but no section renders a currency control — Pricing hard-labels "Price (USD)" (`sections/PricingSection.tsx:16`). Either add a selector or drop the field and say "always USD." The providers section lives in a file/section named "Scheduling" (`sections/SchedulingSection.tsx:15` renders "Payment Providers") — rename to `ProvidersSection`. Edit mode also drops `paypalProductLink`/`active` from `ProductInfo` (`edit/page.tsx:25-43` vs the list's type), so edit starts from a narrower record than the list shows.
- **[P2] List frictions:** instructor filter silently caps at 100 instructors (`products/page.tsx:111`) and silently renders empty if that fetch fails (`:116-118`); no sort on price/date/title; no export; the truncated product-ID chip in Actions (`:473-475`) isn't copyable; no duplicate/clone action for the common "same pack, new price/instructor" case.

*Good:* list fetch errors render a visible banner (`products/page.tsx:367-371`) — the pattern other pages should copy; filters are genuinely server-side (`:137-144`); the submit button explains *why* it's disabled (`product-form.tsx:204-208`); per-field touched validation; delete confirmation names the product and its Stripe ID (`products/page.tsx:532-539`).

---

## 7. Workspaces

### 7.1 List — `app/admin/workspaces/page.tsx`

Job: find a workspace fast (by student/instructor/name), see which mentorships are active/ended, spot stale/empty ones, jump to detail/members/settings. Today: cursor pagination (20/page, Load More) via `useInfiniteQuery` (`page.tsx:44,55-68`), one type filter (`mentorship` / `admin_student` / `admin_instructor`, `:117-127`), columns Name, Type, Owner, Instructor, Images, Created, Actions; create buttons only for Admin-Student / Admin-Instructor (`:96-111`).

- **[P0] Errors are silently swallowed as an empty list.** The query destructures only `data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage` — no `error`/`isError` anywhere (`page.tsx:49-55`). On failure the table renders "No workspaces found" (`:215-221`). Compounded server-side: `convex/adminWorkspaces.ts:110-113` returns an empty page (not an error) when unauthenticated. Render a destructive banner with the message + Retry (the pattern exists in `app/admin/onboardings/page.tsx`); show the empty state only on a successful zero.
- **[P1] No search at all.** The API accepts only `type, numItems, cursor` (`app/api/admin/workspaces/route.ts:7-11`). Finding "the workspace for student X" means Load-More paging through everything. Add a debounced search input + `search` in the route/Convex query (name, owner email/name, instructor name).
- **[P1] Instructor column shows only a raw Clerk ID.** Cell is `<ClerkUserIdCell id={workspace.instructor.userId}>` (`page.tsx:176-182`); the enrichment returns only `{ userId, bio, pricing }` (`convex/adminWorkspaces.ts:88-93`) — no name/email exists to show. Enrich server-side; render name + email primary, Clerk cell secondary.
- **[P1] Status is invisible.** The row type carries `isPublic` and `endedAt` (`page.tsx:31-32`); neither is rendered. Ended workspaces look identical to active ones. Add a Status badge (Active / Ended + date, Public indicator) from the already-fetched fields.
- **[P1] Owner last name dropped.** List type is `owner: { id, email, firstName }` (`page.tsx:28`), rendered as `firstName || "Unknown"` (`:165-167`), while `enrichWorkspaces` already returns `lastName` (`convex/adminWorkspaces.ts:84`). Two owners sharing a first name are indistinguishable except by email. Add `lastName` to the type; render the full name.
- **[P1] Count label is misleading.** `{allWorkspaces.length} workspaces found` (`page.tsx:106-108`) is only the number loaded so far and grows with Load More. Label it "{n} loaded" or expose a real total.
- **[P2]** No sorting; no member count / last-activity columns (the triage columns); Images uses unexplained `S:`/`I:` abbreviations (`:186-190`) — spell out "Student / Instructor images." The only row action besides delete is an icon-only `ExternalLink` button (`:197-201`) that goes to the *internal* detail page (wrong icon semantics, no label; the name itself isn't a link; the row isn't clickable). No quick links to Members/Settings, no bulk actions, and no hint for why there's no "New Mentorship Workspace" button (those come from onboarding) — add a one-line hint linking mentorship creation to `/admin/students/invite`.

*Good:* real cursor pagination with a loading state on Load More; the type filter resets the query key correctly; delete goes through a confirmation dialog (but see §7.2 on its copy).

### 7.2 Detail — `app/admin/workspaces/[id]/page.tsx`

Job: support/triage hub for one mentorship — who's in it, what's been said, what admins have done, and jump to the student/instructor/onboarding behind it. Today: header (name, type badge, Settings + Members buttons, delete), Owner/Instructor/Images cards, and Messages + Audit Logs tabs (`page.tsx:233-351`). Loading and error states are explicit (`:95-112`).

- **[P1] Message authors are unidentifiable.** `Message` carries `userId` (`page.tsx:38-49`) but the renderer shows only `senderRole || "Unknown"` (or System badges) (`:278-296`). In a 1:1 mentorship an admin reading for a dispute/support case can't tell whose message is whose beyond a role string. Resolve `userId` → name/email server-side in `app/api/admin/workspaces/[id]/route.ts` (it already maps messages at `:96-109`) and render author name + role badge.
- **[P1] Messages are unbounded and unsearchable.** The API calls `api.workspaces.getWorkspaceMessages`, whose handler `.collect()`s with no limit (`convex/workspaces.ts:2989-3001`); the UI renders every row with no pagination, search, filter, or date grouping, and prints `message.content` as raw text (`page.tsx:298`) — image/file messages surface as a B2 key/URL string with no preview or download. Long mentorships will degrade this page into unusability. Paginate (a `getWorkspaceMessagesPaginated` already exists), add text search, render image/file messages as thumbnails/download links using the signed URL the Convex query already resolves.
- **[P1] No status in the header.** Type includes `isPublic` / `endedAt` (`page.tsx:68-69`); neither is rendered anywhere. Add Active/Ended (+ date) and Public/Private badges next to the type badge.
- **[P1] Zero cross-links.** Owner is plain text (first name + email, `:178-189` — `lastName` is in the type at `:28` but never rendered); instructor is only a Clerk cell (`:197-205`). No link to the student record, instructor detail, originating onboarding, orders, or session packs. Every follow-up is manual ID-copying. Link owner → student, instructor → instructor, and add a "Related" row (onboarding, session pack) when IDs exist.
- **[P1] Delete from this page is a dead end, and its copy is wrong.** `WorkspaceDeleteDialog` on success only invalidates queries + `router.refresh()` (`components/admin/workspace-delete-dialog.tsx:39-45`) — no redirect — so from the detail page the admin stays on a now-deleted workspace, which then renders "Failed to load workspace: Not found." The dialog also says "This action cannot be undone" (`workspace-delete-dialog.tsx:71`) while the API is a **soft** delete (sets `deletedAt`, `app/api/admin/workspaces/[id]/route.ts`). Misleading in both directions. Redirect to `/admin/workspaces` on delete from detail; reword to reflect soft delete (or implement restore and say so).
- **[P1] Audit Logs tab is silently truncated.** The API supports `numItems`/`cursor` (default 50; `app/api/admin/workspaces/[id]/route.ts:66-77`) but the UI never passes them, renders no Load More and no count — the tab label is just "Audit Logs" vs "Messages ({n})" (`page.tsx:235-242`). Admins see the first page believing it's everything. Note every detail view also writes a `view_workspace` audit event (`route.ts:87-93`), so the log self-pollutes. Show the count, add Load More using the returned `continueCursor`/`isDone` (already in the response type, `page.tsx:74-78`), and filter `view_workspace` by default.
- **[P2]** Instructor bio is truncated as `bio.slice(0, 50) + "..."` (`page.tsx:209-211`) — the ellipsis is appended even for bios shorter than 50 chars, with no expand. The Images card repeats cryptic counts with no gallery. No sessions/resources/links tabs despite those being core workspace content.

*Good:* distinct loading/error/loaded states; system (call join/leave) messages render distinctly with badges instead of as "Unknown" authors (`:264-296`); Settings/Members shortcuts in the header.

### 7.3 Members — `app/admin/workspaces/[id]/members/page.tsx`

Job: see everyone attached to the workspace and safely reassign owner/instructor. Today: two cards only — Owner (current + transfer-by-email-search) and Instructor (current + select-to-reassign) (`page.tsx:158-331`); the instructor card is hidden for `admin_student` workspaces (`:147`).

- **[P1] The page name promises a member list that doesn't exist.** There is no list of members/participants at all — just the single owner and single instructor assignment forms. Rename to "Ownership & Instructor," or add a read-only participants list above the assignment cards.
- **[P0/P1] Student names are fetched-then-discarded, so search results show email only.** The search mapping builds `StudentItem` as `{ id: userId, userId, email }` (`page.tsx:86-96`), dropping `firstName`/`lastName` although the type declares them (`:40-46`) and the result button renders `student.firstName || student.email` (`:215`) — the name branch is dead code. Same bug replicated in the create page (§7.5). Map the names through (fix once in a shared mapper) and render "Full name — email."
- **[P1] Ownership transfer has no safeguard.** Selecting a search result reveals a "Transfer Ownership" button (`:228-245`); one click fires the mutation. No confirmation naming old → new owner, no warning about consequences (access, billing/session ownership), no type-to-confirm. The most destructive action in this cluster has less friction than deleting a workspace. Add a confirmation dialog spelling out the transfer and its consequences.
- **[P1] Current instructor is only a Clerk ID, and the picker can silently assign an inactive instructor.** Current instructor renders as `ClerkUserIdCell truncateAt={12}` (`:262-268`). The picker loads `getAdminInstructors({ includeInactive: true })` (`:52-61`) with no inactive badge in the options (`:296-300`), and its fallback chain `name || email || id.slice(0,8)` uses an `email` field the mapping never sets (it maps only `id, userId, name`, `:54-60`). Show name/email as the current value; exclude inactive by default or badge them; fix the mapping to carry `email`.
- **[P2]** Success/error feedback is a banner that auto-dismisses after 2 s (`:115`) rendered below the grid (`:322-331`) — it can be off-screen after clicking Save inside a card. `canChangeOwner = true` is a hard-coded dead flag (`:148`). Owner search only queries students (`getAdminStudents`) with no hint that's intentional. No links from current owner/instructor to their detail pages. Use a toast or inline the result in the card that was saved; remove the dead flag.

*Good:* debounced (300 ms) owner search with a "Searching…" indicator and an explicit "No students found" state (`:199-226`); separate Save per card so owner and instructor changes can't be half-submitted together.

### 7.4 Settings — `app/admin/workspaces/[id]/settings/page.tsx`

Job: rename/describe, control visibility, see immutable facts, perform lifecycle actions. Today: one form (Name, Description, Public Visibility switch) + a read-only Info card (Type, Created, Owner ID, Status) (`page.tsx:113-224`).

- **[P1] The riskiest toggle has no confirmation.** `isPublic` is described in its own copy as "Allow workspace to be accessed via direct link **without authentication**" (`:146-149`) and flips with a bare Switch + Save — no confirm, no warning styling, no audit hint. Require a confirmation dialog when toggling private → public, with the unauthenticated-access consequence spelled out.
- **[P1] Status is displayed but not actionable — a dead end.** The Info card derives `Status: Ended/Active` from `endedAt` (`:216-220`) but there is no End / Reactivate control anywhere in Settings (or Detail), and the ended date isn't shown. Add End/Reactivate actions with confirmation — or, if ending intentionally happens elsewhere, link to it.
- **[P1] Read-only card shows IDs instead of people, and raw enum values.** Owner is only `Owner ID` in mono (`:211-214`); Type is the raw string (`admin_student`, `:203-206`). The page's local `WorkspaceDetail` type (`:19-28`) omits the `owner`/`instructor` objects the same `getAdminWorkspace` call already returns, so it *cannot* show a name. Reuse the full detail type; show owner name + email (link to Members) and human type labels matching the list/detail badges.
- **[P2]** Description is a single-line `<Input>` (`:135-142`) — use a textarea. Save is always enabled with no dirty check and no unsaved-changes warning. The PATCH API also accepts `imageUrl` (`app/api/admin/workspaces/[id]/route.ts`, `updateWorkspaceBodySchema`) which this form never exposes. Success/error banners auto-dismiss in 2 s (`:57-61`).

*Good:* client-side name validation with an inline error that clears on typing (`:66-76,124-132`); mutation errors surface in the form, not swallowed.

### 7.5 Create — `app/admin/workspaces/create/page.tsx`

Job: pick the right person, optionally name/describe the private admin-communication workspace, create it, land somewhere useful. Today: type from `?type=` (default `admin_student`, `:61-64`); searchable user picker (left) + review card (right); Create disabled until a user is selected; success redirects to the new workspace detail (`:99-111`).

- **[P1] Search is a no-op for Admin-Instructor workspaces.** The student query passes `search: debouncedSearch` to the server (`:76`), but the instructor query (`fetchInstructors`, `:88-96`) takes no search argument and `items` is never filtered client-side (`:134-136`). Typing in "Search users…" with `type=admin_instructor` changes nothing except a dimming opacity. Filter client-side by name/email, or add server search as students have.
- **[P1] Any unrecognised `type` silently becomes Admin-Instructor.** All branching is `workspaceType === "admin_student" ? … : …` (heading `:148`, picker `:160-176`, submit `:124-128`). `?type=mentorship` or a typo renders an Admin-Instructor creation flow with no warning. Validate `type` against the two allowed values and render an explicit error/chooser otherwise; also add an in-page type switcher (changing your mind currently means going back to the list).
- **[P1] Student names dropped, same as Members (§7.3).** The mapping builds items with only `id, userId, email` (`:79-87`), so `displayName = item.firstName || item.email || item.userId` (`:205-208`) always resolves to email; the "Selected User" summary (`:264-270`) can only ever show an email/ID.
- **[P1] Duplicate creation is silent.** Convex `createAdminStudentWorkspace` returns the *existing* workspace if one already exists for that student (`convex/adminWorkspaces.ts:187-203`, audit-logged as "Returned existing workspace"), and the UI unconditionally `router.push`es to `data.id` (`page.tsx:99-103`). The admin believes they created a new workspace; nothing says "this student already had one — opened instead," and no picker row indicates who already has one. Return a `created: boolean` from the API, show "Opened existing workspace" feedback, and badge picker rows that already have a workspace of this type.
- **[P2]** The visibility switch offers "Public — visible with link" (`:280-293`) with no extra warning at creation. Instructor rows with no name fall back to a `<ClerkUserIdCell>` inside a clickable div (`:211-219`) — nested interactive elements. The empty state doesn't differentiate "no users exist" from "no matches for your search" (single "No users found," `:236-241`).

*Good:* two-pane select-then-review layout; Create correctly disabled with no selection; student search has a clear button and debounce affordance; success lands on the created workspace.

---

## 8. Onboardings and the onboarding form

### 8.1 List — `app/admin/onboardings/page.tsx`

Job: triage Kajabi/manual onboarding submissions — failures first, retry them, find a specific student/instructor, export for reporting. Today: **the strongest page in this audit** — status tabs defaulting to "Needs attention" (failed), one search fanning out to email OR instructor name server-side, sortable Submitted/Status/Attempts columns, client "bulk filters" (Failed last 7d, Stale 13d+), CSV export of visible rows, per-row Retry + View (`page.tsx:123-373`).

- **[P1] Instructor names are fetched, exported — and not displayed.** The Convex query enriches every row with `instructorNames` (`convex/adminOnboarding.ts:976-991`; type at `lib/queries/convex/use-admin-onboardings.ts:96-118`) and the CSV includes them, but the Instructors column renders only a count: `{n} ({m} renewal)` (`page.tsx:331-333`). Triaging "all of Instructor X's failed onboardings" requires opening every row or exporting CSV — the same failure mode as §1. Render the names in the cell (count/renewal badge secondary).
- **[P1] Hard 50-row ceiling with misleading counts and sort.** The query is called with `limit: 50` (`:137-142`); there is no pagination/Load More. The header count is `items.length` of that window (`:238-242`), and sorting sorts only those 50 client-side — sorting by Attempts on the Completed tab reorders an arbitrary newest-50, it does not surface the highest-attempt record overall. Nothing tells the admin more rows exist. Add cursor pagination, or disclose the cap ("showing newest 50 — refine search") and label sorting "sort visible."
- **[P1] "Failed (last 7d)" filter is mislabelled — its timestamp doesn't exist.** `matchesBulkFilter` uses `item.lastAttemptAt ?? item.createdAt` (`:80-88`), but `lastAttemptAt` is on neither `AdminOnboarding` nor `AdminOnboardingListItem` (`use-admin-onboardings.ts:44-118`) — it always falls back to `createdAt`. The filter actually means "submitted in the last 7 days," so a long-queued onboarding that failed yesterday is hidden. Add a real `lastAttemptAt`/`updatedAt` to the list projection and filter on it, or rename the filter to match `createdAt` semantics.
- **[P1] No Cancel action anywhere, despite a purpose-built API.** `POST /api/admin/onboardings/[id]/cancel` exists and its doc comment says it is "Used by the recovery dashboard's per-row Cancel action" (`app/api/admin/onboardings/[id]/cancel/route.ts:10-16`) — yet neither this list nor the detail page renders a cancel control (grep: only status labels / `cancelledAt` display). A stuck `queued`/`processing` onboarding can be retried but never cancelled from the UI. Add Cancel (with confirmation) on failed/queued/processing rows and on the detail header, wired to the existing route.
- **[P1] No path to create a new onboarding.** The page is explicitly a "Recovery view" (`:203-205`) with no "New onboarding" button; the creation form lives at `/admin/students/invite` (§8.3) and isn't linked from here or vice versa. Add a primary "New onboarding" button → `/admin/students/invite`. Tabs also carry no counts/badges, so the size of the Failed backlog is invisible until the tab is opened — add per-tab counts.
- **[P2]** Submitted shows only relative time (`formatRelative`, `:103-110`) with no absolute date on hover. The Failure column prints raw `failureReason` with no truncation/wrap control (`:341-343`). Email is plain mono text — no link to the student record, no copy affordance. Add `title={absolute date}`, clamp failure text with expand-on-click, and a copy button on email.

*Good:* explicit error panel with the real message (not an empty list) (`:290-295`); empty state distinguishes "hidden by filter" from "none in this state" and offers Refresh (`:300-318`); CSV export is injection-escaped and BOM-prefixed for Excel; bulk-filter hidden-row count is disclosed (`:262-266`); sortable headers expose `aria-sort`. **This page is the reference implementation the workspace pages should be brought up to.**

### 8.2 Detail — `app/admin/onboardings/[id]/page.tsx`

Job: for one submission — who is it for, which instructors/workspaces did it create, did the student get invited and answer the questionnaire, why did it fail, and what do I do next. Today: header action bar (status, attempt count, Resend Invitation, Retry), Summary + per-instructor cards, a full Student Questionnaire card, and a Timeline card (`page.tsx:120-553`). Loading, error, and not-found are three distinct states (`:102-110,155-183`).

- **[P1] Per-instructor cards identify instructors and workspaces only by raw IDs — with no links.** Each row shows `p.instructorId` in mono (`:285-287`) and, if present, `Workspace: <mono>{p.workspaceId}</mono>` (`:292-295`) as plain text. Unlike the list, the detail query isn't enriched with instructor names. The most obvious next action — "open that workspace" → `/admin/workspaces/{workspaceId}` — is not a link. Same pattern for `Submitted by: <mono>{submittedByUserId}</mono>` (`:208-211`). Enrich `getAdminOnboarding` with instructor name/email (as the list query already does); render the workspace ID as a `Link`; link the submitter to the user record.
- **[P1] "Did the student actually get emailed?" is unanswerable.** The record type carries `emailsSent { student, instructors, adminSummary, stub }`, plus `existingWorkspaceIds`, `isSeparateStudentRecord`, `onboardingAlias`, `cancelledByUserId` (`lib/queries/convex/use-admin-onboardings.ts:60-84`) — none is rendered anywhere on the detail page (grep: 0 hits). For a recovery view, whether invitation/welcome emails were sent (or stubbed) is core diagnostic info; today an admin can only blindly press Resend. Add an "Emails" section to Summary rendering `emailsSent` per recipient, `existingWorkspaceIds` as workspace links, and badges for separate-record/alias rows.
- **[P1] No Cancel action (see §8.1).** The header offers only Resend + Retry (`:128-148`), although the cancel route exists and Summary already knows how to display `cancelledAt` (`:218-224`).
- **[P2]** The header duplicates Summary (status badge + attempt count in both, `:124-127` vs `:193-205`) while higher-value header info (student email, submitted date) sits only in the card. Timeline entries carry `actorUserId` in the type (`use-admin-onboardings.ts:29-34`) but the renderer shows only time + label + details (`:530-548`) — who performed an action is dropped. Email in Summary is plain mono with no mailto/copy (`:189-192`).

*Good:* the best error/empty handling in the audit — the questionnaire distinguishes loading / errored (with the raw error in mono and "do not mistake this for no submission" copy) / not-yet-submitted / submitted (`:330-420`), and work examples repeat the discipline, filtering pending uploads so they can't render as broken placeholders (`:52-62,466-505`). Not-found is a dedicated panel with a way back (`:168-183`). Capacity-override and failure reasons get prominent callouts (`:226-240`); student timezone is surfaced for scheduling (`:248-268`).

### 8.3 Onboarding form — `components/admin/admin-onboarding-form.tsx` (used at `app/admin/students/invite/page.tsx:255`)

Job: onboard a (usually Kajabi) student — email → one or more instructors with sessions/expiry → preview consequences → commit and send invitations. Today: a two-phase Preview → "Confirm and Send" flow with an existing-student lookup banner, per-instructor session/expiry rows, an advanced "separate student record" split gated by a confirmation dialog + required notes, a Preview panel, and a Commit-result panel linking to the onboarding detail.

- **[P1] Instructor picker doesn't scale: no search.** `InstructorMultiSelect` renders every instructor as a checkbox row in a `max-h-64` scroll box (`admin-onboarding-form.tsx:562-574`) with no filter input. The workspace pickers all have search; this one — used for the highest-value admin task — doesn't. Add a filter input over the options (name/email).
- **[P1] Preview hides the capacity data it already fetched.** The preview schema includes `atCapacity`, `activeStudentCount`, `maxActiveStudents`, `capacityOverrideRequired` per instructor (`:42-53`), but `PreviewPanel` renders only name, sessions, expiry, and a New/Renewal badge plus free-text warnings (`:690-730`). At the exact decision point, the admin isn't shown "this instructor is at 8/8" as structured info. (Also: `postPreview`/`postCommit` accept a `capacityOverrideReason` param, `:97-127`, that neither call site ever passes, `:267,287` — dead plumbing.) Render seat counts / at-capacity badges per preview row (the multi-select already badges them at selection time); delete the dead param or wire it.
- **[P1] Commit result doesn't link to the workspaces it created.** `CommitResultPanel` has each pair's `workspaceId` (`:92-100`) but renders only the text "New workspace created" (`:790-800`), while the onboarding ID *is* linked ("View detail," `:765-772`). The natural next step — open the workspace to message the student — requires navigating via the onboarding detail, whose workspace ID is itself unlinked (§8.2). Two dead ends in series. Link `workspaceId` → `/admin/workspaces/{id}` in the result panel.
- **[P2]** Sessions input silently clamps: `Math.max(1, Number(value || 0))` (`:640-645`) makes clearing the field snap to 1 with no explanation; expiry accepts past dates with no validation. The "email plan" line (1 student / N instructors / 1 admin) is derived client-side (`:305-312`) rather than from the preview response, so it can drift from what the server will actually send. Allow empty-then-validate with an inline error; validate expiry ≥ today; drive the email plan from preview data.

*Good:* preview is invalidated when the draft changes (fingerprint check, `:200-220`) so an admin can't commit against a stale preview; existing-student and prior-onboarding banners appear *before* preview, with a link to `/admin/onboardings` (`:520-560`); the separate-record split requires a modal confirmation and mandatory notes, gated on the server's `notesRequired` flag (`:290-303`); capacity badges are shown during selection (`:575-605`).

---

## 9. Audit logs, email health, layout/nav, error boundary

### 9.1 Audit Logs — `app/admin/audit-logs/page.tsx`

Job: forensics and accountability — who did what, to what, when — especially around money, access, and destructive actions. Today: one table (Timestamp, Admin as Clerk ID cell, Action badge, raw Details string, View-workspace link) with cursor pagination / Load More, 50/page (`page.tsx:35,44-54,147-164`).

- **[P0] The page's scope is far narrower than its name promises — and nothing says so.** Subtitle: "Track admin actions in workspaces" (`:77-79`). The backing table is `workspaceAuditLogs`, whose action enum is only 8 workspace actions (`convex/schema.ts:1085-1094`), served unfiltered by the route (`app/api/admin/audit-logs/route.ts:16-27`). **Refunds, product create/edit/delete, instructor edits, student invitations, and role changes never appear here.** An admin investigating "who refunded this order?" will find nothing and may conclude it didn't happen. A separate general `auditLogs` table exists (`convex/schema.ts:1106+`) but isn't surfaced. Minimum fix: retitle to "Workspace Audit Logs" and state the scope. Proper fix: merge both sources into one timeline with a Source/Type filter.
- **[P0] Query failure renders as "No audit logs found."** The hook destructures no `error`/`isError` (`page.tsx:38-44`); on failure the empty row renders (`:136-142`). For an accountability tool, "system down" masquerading as "nothing happened" is the worst failure mode. Render the error with Retry, distinct from empty.
- **[P1] No search or filtering of any kind** — no filter by admin, action, workspace, or date range in the UI or the API (`audit-logs/route.ts:17-18` accepts only `numItems`/`cursor`). Finding one event among thousands means clicking Load More and eyeballing. No export for compliance/incident review. Add server-side filters + CSV export.
- **[P1] The count is misleading.** "{allLogs.length} log entries" (`:86`) is the number *loaded so far*, growing by 50 per Load More — it reads as a total. Label it "Showing N entries" or return a true total. (Same pattern as workspaces §7.1 and onboardings §8.1 — fix the pattern once.)
- **[P1] Rows don't identify people or targets usefully.** Admin is only a Clerk ID cell (`:114-119`) — no name/email resolution. The workspace is only a "View" button (`:126-133`) — no workspace name/owner, so you can't tell which workspace a row concerns without clicking through. `details` is a raw, untruncated, unexpandable string (`:121-125`). Resolve admin name/email (Clerk ID secondary), show workspace name + student/instructor, render details in an expandable row with structured formatting.
- **[P2] Incomplete badge vocabulary.** `getActionBadge` maps 5 actions (`:56-71`); the schema's `delete_workspace`, `update_workspace`, `transfer_workspace_ownership` fall through to a raw snake_case badge — the most sensitive actions look the least finished. Map all 8 with human labels (destructive variant for Delete / Ownership transfer). Timestamps use locale string with no relative time or timezone cue (`:111`), inconsistent with Email Health's UTC format — standardise (see §9.2).

*Good:* cursor-based infinite loading is the right model for an append-only log (`:44-52`); the Clerk ID cell includes a dashboard link (`:115-118`), appropriate for an admin-only surface; the workspace deep link exists.

### 9.2 Email Health — `app/admin/email-health/page.tsx` (+ trend card, window picker)

Job: deliverability early-warning — are bounces/complaints/suppressions spiking, for which domains, and is there an address to act on before Resend reputation suffers? Today: **the most thoughtfully built page in this cluster** — server-rendered, URL-driven window picker (1/3/7/14/30d), 5 total cards, a trend card comparing Resend API vs webhook counts with divergence flagging and an honest methodology description, Denied Domains list, per-domain severity table, and recent suppression events. Scan truncation is surfaced in the header (`page.tsx:87-91`) and the trend footer (`email-metrics-trend-card.tsx:258-269`).

- **[P1] It's a read-only dead end — diagnosis with no treatment.** A Critical domain or a suppressed student email offers no action: no link from an event's email to that student/instructor, no "remove from suppression / allowlist" action, no link to the affected workspace or order, and Denied Domains — described as "manually flagged" (`page.tsx:145`) — has no add/remove UI on the page at all. The admin must leave and fix things in Resend/Convex by hand. Add per-event actions (View student, Copy email, Remove suppression with confirmation), inline denied-domain management, and domain → affected-users links.
- **[P1] "Per-Domain Rates" contains no rates.** The card title (`page.tsx:176`) promises rates; its own description admits "Thresholds are absolute counts over the window (rates arrive with PR Metrics 3b once delivered counts land)" (`:177-180`). Meanwhile the trend table *does* show bounce/complaint % (`email-metrics-trend-card.tsx:228-229`). Retitle to "Per-Domain Counts" until denominators land; then show rate + volume together.
- **[P1] No triage controls on the event stream.** Recent Events (`page.tsx:233-282`) is an unfiltered, unpaginated tail ("Last N of M scanned," `:237`) — no filter by kind/domain, no search by email, no pagination to older events, no export. The one workflow this table exists for — "find everything for gmail.com / this student" — isn't possible beyond the visible tail. Add kind + domain filters and email search (server-side) plus "View all" pagination.
- **[P2] Totals cards lack denominators/threshold context.** Five raw counts (`page.tsx:101-136`) with no delivered volume, no rate, no delta vs the previous window, no indication of what number should worry you. Add delivered count + rate under Bounces/Complaints and a vs-previous-window delta.
- **[P2] Timestamp format is unlabelled UTC and inconsistent with the rest of admin.** `formatTimestamp` slices an ISO string (`page.tsx:48-50`; same in `email-metrics-trend-card.tsx:105-108`) — UTC with no "UTC" label — while Audit Logs/Orders render locale time. Cross-referencing an email event against an audit event invites off-by-hours mistakes. Build one shared admin timestamp component: locale time + relative ("2h ago") + full timestamp on hover, and use it everywhere.
- **[P2] The whole page fails to the generic error boundary.** The page is a server component awaiting two `fetchQuery` calls with no local try/catch (`page.tsx:64-75`); any Convex failure lands on `error.tsx`'s raw-message page (§9.4) instead of a partial render. Catch per-section and render section-level error cards.

*Good (keep as the pattern for other pages):* URL-driven window state with custom-value handling (`email-health-window-picker.tsx:24-30`); truncation/high-water honesty in three places; "Unknown" severity instead of a misleading colour when data is incomplete (`email-metrics-trend-card.tsx:51-55,138-140`); methodology in plain English in the card description (`:131-141`); lazy-loaded chart so tables render first (`:23-33`).

### 9.3 Layout / navigation — `app/admin/client-admin-layout.tsx`, `app/admin/layout.tsx`

Today: fixed 264px sidebar (`client-admin-layout.tsx:50`) with 9 flat nav items (`:23-33`), user footer with `UserButton` + name/email + Sign Out (`:79-112`), content at `p-8` (`:115`); the server layout gates on admin role (`layout.tsx:7-19`).

- **[P1] No environment indicator.** Nothing says Production vs Staging/dev — yet this same UI processes real Stripe/PayPal refunds and deletes products that archive Stripe objects. Render an env badge from `NEXT_PUBLIC_VERCEL_ENV` in the sidebar header; add a coloured top border in non-prod.
- **[P1] No attention badges and no global search.** Nav is purely structural: no count on Onboardings (pending), no dot on Email Health when a domain is red (data the dashboard card already computes), and no way to jump straight to a student/instructor/order. Add badge counts and a ⌘K-style global search hitting the existing admin search endpoints.
- **[P1] Not responsive.** `w-64` sidebar with no collapse (`:50`) plus `p-8` content (`:115`); the wide tables already rely on `overflow-x-auto` — on a half-screen laptop or tablet the sidebar permanently eats a third of the viewport. Collapsible icon rail under `lg`, or a top bar on small screens.
- **[P2] No breadcrumbs / section context on nested pages.** Create/Edit Product, Invite Student, and detail pages get no breadcrumb; some compensate with their own back link (Invite does, `students/invite/page.tsx:84-87`), Products create/edit don't (only a "View Products" button, `product-form.tsx:116-118`). Derive one breadcrumb component from the pathname in the layout.
- **[P2] Dead ends in the chrome.** No link back to the non-admin app; Sign Out duplicates the Clerk `UserButton` menu directly above it (`:84-102`); non-admins are redirected to `/dashboard?error=unauthorized` (`layout.tsx:11`) with nothing surfacing that error param. Drop the redundant Sign Out (or the UserButton), add "← Back to app," render the unauthorized notice at the redirect target.

*Good:* active-state logic is correct including nested routes (`:59`); the role gate is server-side before any client chrome renders (`layout.tsx:26`).

### 9.4 Error boundary — `app/admin/error.tsx`

22 lines: the raw `error.message` (or a fallback) and one button labelled "Refresh Page" that calls `reset()` (`error.tsx:13-20`).

- **[P1] Raw internal error messages are shown verbatim** (`:15`). Convex/Stripe/auth errors can include internal IDs, query paths, or provider detail — noisy at best, leaky at worst, never actionable. Show a friendly generic message + the Next.js `digest` (already in props, `:9`, currently unused) as a support reference; log the full error.
- **[P2] Mislabelled recovery + no escape hatch.** The button says "Refresh Page" but calls `reset()` (segment re-render, not a reload) (`:17-19`); there's no link back to `/admin` and no heading, so a persistent error leaves one misleading button inside an otherwise intact sidebar. Label it "Try again," add "Back to Dashboard," add a heading ("Something went wrong loading this page").

*Good:* a dedicated admin-segment boundary exists at all, and a fallback message covers the empty-message case (`:15`).

---

## 10. Cross-cutting patterns (fix the pattern, not just the page)

1. **Error ≠ empty.** Workspaces list, instructors list, students list (+ API `206`), orders, audit logs, invitations, instructor expansion, email-health card all render failure as emptiness. Adopt one shared list-state pattern — the Products list banner (`products/page.tsx:367-371`) and the Onboardings error panel (`onboardings/page.tsx:290-295`) are the in-repo references — and apply it to every list: *loading / error (message + Retry) / truly empty / no-matches-for-filter* as four distinct states.
2. **No success-feedback system.** Refund success, product delete, invite send, inventory save, workspace save all complete by silently closing/refetching or with a 2-second auto-dismiss banner (workspace members `page.tsx:115`, settings `page.tsx:57-61`) — while instructor edit uses a blocking modal for every save and `RetryOnboardingButton` uses a toast. Adopt one toast pattern (e.g. sonner) for routine success, keep inline result summaries for money actions ("Refunded $375.00 to student@example.com — Stripe re_…"), and reserve modals for consequences that must be read.
3. **IDs where names belong, text where links belong.** Instructor = Clerk ID (workspace list/detail/members), instructor = raw Convex ID (onboarding detail), workspace = raw ID (onboarding detail, onboarding-form result), owner = raw ID (workspace settings), admin = Clerk ID (audit logs). In almost every case the name/email or the target route already exists in the data or the app. Convention (already in the repo): **name first, email second, Clerk ID only as a muted secondary/debug element with a label** — the students list ID line (`students/page.tsx:226-235`) and `ClerkUserIdCell` usage in instructor Basic Info are the models.
4. **Destructive-action friction is inverted.** Confirmation dialogs exist for: workspace delete (soft delete, copy falsely says "cannot be undone"), product delete, hard instructor delete, separate-record onboarding split. **No** confirmation for: workspace ownership transfer, making a workspace publicly accessible without authentication, instructor testimonial/result deletion, product deactivation side effects (discovered after save). Audit every destructive/consequential action and set friction proportional to reversibility and blast radius.
5. **Filter/search/pagination state is inconsistent.** Email Health puts its window in the URL (shareable, back-button safe — `email-health/page.tsx:62`); Orders and Products keep filters in `useState` only (`orders/page.tsx:225-226`; `products/page.tsx:96-100`), so refresh/share/back loses the admin's place mid-investigation. Move list filters + page to `searchParams` everywhere. Confirmation primitives are likewise three different things: hand-rolled modal (refund), shared `Dialog` (product delete), `window.confirm` (invite cancel) — standardise on the shared `Dialog`.
6. **Two inconsistent admin stacks.** Onboardings (Convex hooks) have explicit error/not-found/empty states, sorting, search, and CSV export. Workspaces (REST `api-client`) swallow errors, truncate silently, and use auto-dismiss banners. Bring workspaces up to the onboarding standard first — the reference implementation already exists in the codebase.
7. **Counts that aren't totals.** "{n} found/entries/results" renders the *loaded window* in workspaces (§7.1), audit logs (§9.1), onboardings (§8.1), and students (§4.1). Either return real totals from the API or label honestly ("{n} loaded," "showing newest 50").
8. **Copy-paste bug replication.** The `getAdminStudents` mapping that discards `firstName`/`lastName` appears identically in workspace members (`page.tsx:86-96`) and workspace create (`page.tsx:79-87`), leaving dead name-render branches in both. Extract a shared student-picker mapper/component — the admin has at least four user pickers (these two, onboarding multi-select, Add Sessions instructor select) that should be one component with search, name+email rendering, and inactive badging.

---

## 11. Page inventory (all admin routes in `apps/platform`)

| Route | Verdict in one line |
|---|---|
| `/admin` (dashboard) | Stats are fake zeros (§2); instructor expansion broken (§1); no attention queue |
| `/admin/instructors` | No students/capacity data despite API having it; silent 100 cap; hard-delete as the row action (§3.1) |
| `/admin/instructors/create` | Invitation + image outcomes discarded (§3.2) |
| `/admin/instructors/[id]/edit` | Form data-loss on refetch; Kajabi verify is a green-light generator; no Students tab (§3.3) |
| `/admin/students` | Page 2+ unreachable; Clerk ID as headline fallback; rich API filters unexposed (§4.1) |
| `/admin/students/invite` | No send feedback; invitations list unpaged/unsearchable, no error states (§4.2) |
| `/admin/orders` | Status filter + search don't work server-side; orders show no product/instructor/pack (§5) |
| `/admin/products` | Best error handling in the admin; no activate/deactivate; no commercial context (§6) |
| `/admin/products/create` · `/[id]/edit` | Edit opens on a nonexistent tab; create discards its ResultCard (§6) |
| `/admin/workspaces` | No search; errors = empty list; instructor is a Clerk ID; status invisible (§7.1) |
| `/admin/workspaces/[id]` | Messages unidentifiable, unbounded, unsearchable; delete is a dead end (§7.2) |
| `/admin/workspaces/[id]/members` | No member list; names discarded; transfer has no confirmation (§7.3) |
| `/admin/workspaces/[id]/settings` | Public-access toggle unconfirmed; Ended status not actionable (§7.4) |
| `/admin/workspaces/create` | Instructor search is a no-op; bad `?type=` silently becomes Admin-Instructor (§7.5) |
| `/admin/onboardings` | Strongest list page; names hidden behind counts; 50-row cap; Cancel API unused (§8.1) |
| `/admin/onboardings/[id]` | IDs instead of names/links; `emailsSent` never rendered; no Cancel (§8.2) |
| `/admin/email-health` | Best-built page; read-only dead end; "Rates" card has no rates (§9.2) |
| `/admin/audit-logs` | Workspace-only scope under a general name; failure = "no logs"; no filters (§9.1) |

---

## 12. Suggested implementation order for OpenCode

Ship in small, separately reviewable batches. **Verify each item against current `main` first** — this brief is pinned to `1c97333`.

**Batch 1 — Stop lying to the admin (P0 data correctness)**
1. §1 instructor-students route: rewire to `getInstructorWithStudents` (Option A) or flatten the grouped shape (Option B); surface fetch errors in the widget; fix the "Last Session" label; add a route test with a realistic payload.
2. §2 dashboard stats: wire `/api/admin/stats` to `convex/users.ts` `getAdminStats`, align field names (`totalActiveStudents`/`hasStudentData`), delete the placeholder — or hide the cards until wired.
3. §5 orders: add `status` + `search` to the route schema and `getOrdersForAdmin` (filter before paginating, `by_status` index exists).
4. §6 product form: `activeTab` initial value `"create-new"` in edit mode.
5. §3.3 instructor edit: stop `useInstructorForm` re-hydrating on every refetch (first-load guard).

**Batch 2 — Reachability & silent truncation (P0/P1)**
6. §4.1 students pagination: thread `page`/`pageSize`/`total` through `getAdminStudents`; honest "Showing X–Y of Z."
7. §3.1 instructors list: switch to the REST stats endpoint (students/capacity columns), error state with Retry, status filter replacing "Show inactive," email + Listed visibility.
8. §4.1 students headline: API returns `name`; headline never falls back to a raw Clerk ID.
9. Error-vs-empty pass (§10.1) for workspaces list, orders, audit logs, invitations, instructors list — copy the Products/Onboardings patterns.

**Batch 3 — Money & destructive-action safety (P1)**
10. §5 refund modal rebuild on `Dialog` (context, refunded/remaining summary, consequence copy + link, amount validation, per-payment actions, success receipt with provider refund ID); render `refundedAmount` on order rows; fix the refund email's instructor/student names; fix the Stripe deep-link builder.
11. §5 order rows/detail: join product, instructor, pack (sessions used/remaining), workspace link.
12. §7.3 ownership-transfer confirmation; §7.4 public-visibility confirmation; §3.3 testimonial/result delete confirmation; §7.2 workspace-delete copy + post-delete redirect.

**Batch 4 — Convergence & cross-links (P1)**
13. §1.3/§3.1/§5 (cluster comparison): make `/admin/instructors` the superset surface (stats + expansion + inline inventory), demote the dashboard widget to a summary card ("N instructors · M at capacity · View all →"); adopt the single canonical `activeStudentCount` definition (§1.4) everywhere including onboarding capacity.
14. §3.3 instructor edit: Students tab; inventory utilisation; dirty state + navigation guard; toast instead of the routine success modal; per-tab validation surfacing; "Instructor ID" relabel; load-error state.
15. Cross-link sweep (§10.3): onboarding detail/form-result workspace links, workspace detail owner/instructor links, members/settings name rendering, audit-log identity resolution, product list instructor links + active-student counts.
16. §8 onboardings: render instructor names in the list; wire the existing Cancel route into list + detail; render `emailsSent` on detail; disclose/paginate the 50-row cap; fix or rename the "Failed (last 7d)" filter.

**Batch 5 — Polish & consistency (P2)**
17. Shared admin primitives: toast system, list-state component, timestamp component, user-picker component (§10.8), confirmation `Dialog` standard.
18. Filters/search/page in URL `searchParams` for Orders/Products; nav attention badges + env indicator + global search (§9.3); `error.tsx` friendly message + digest (§9.4).
19. §6 products: Active toggle, create ResultCard, hide import tab in edit, price-change rendering, clone action.
20. §9.1 audit logs: retitle/scope statement now; merged timeline + filters next. §9.2 email health: per-event actions, "Counts" retitle, event filters.

---

## Appendix — what was *not* verified

- No live deployment was opened; runtime behaviour (e.g. whether staging data would make any given list non-empty) was not observed. The P0s in §1, §2, §5, §6 are deterministic from the code alone and do not depend on live data.
- `apps/web` and `apps/marketing` admin surfaces were out of scope (retirement decided 2026-11-08). Note `convex/admin.ts` `getInstructorWithStudents` *is* consumed by `apps/marketing` — if marketing's admin instructor view works there, its rendering is a useful reference for Batch 1, item 1.
- Accessibility was assessed only where it intersected a finding (focus traps, `aria-label`s, `aria-sort`); a dedicated a11y pass was not done.

---

## Errata — review of this brief (2026-11-16)

Checked against `origin/main` @ `1c97333` with `git show` only (no branch switch). Findings below
supersede the corresponding text above.

### Corrections

1. **§2 names the wrong Convex query.** `convex/users.ts` `getAdminStats` (`:1334`) returns
   *instructor counts and file-storage bytes* (`totalFiles`, `totalBytes`, `activeBytes`) — it is not
   dashboard statistics. The real implementation is **`convex/admin.ts` `getStats` (`:252`)**, which
   already returns the exact shape `apps/platform/lib/queries/api-client.ts` expects
   (`totalActiveStudents`, `revenueThisMonth`, `revenueLastMonth`, `revenueChange`, `revenueThisYear`,
   `hasRevenueData`, `hasStudentData`, `hasHistoricalRevenue`, with cents→dollars division). It is
   currently consumed only by `apps/marketing`. The fix is a small route change, not a data-model
   project.

2. **§3.1's "switch to the REST stats endpoint" does not remove the 100-row cap.** The REST route
   forwards `pageSize` into `getInstructorsForAdmin`, which defaults to
   `DEFAULT_INSTRUCTOR_LIST_LIMIT = 100` (`convex/instructors.ts:1404`). Switching sources buys the
   stats columns; eliminating truncation needs pagination in the Convex query. Batch 2 item 7 is two
   items, not one.

3. **§5's "add `status` + `search`" is a query rewrite.** `getOrdersForAdmin` (`convex/orders.ts:84`)
   does `ctx.db.query("orders").collect()` and then sorts/paginates in memory. Filtering *before*
   pagination means index-backed pagination (the `by_status`/`by_status_createdAt` indexes exist) plus
   a user-email join for search. Budget accordingly.

### Additions the brief omits

4. **Root-cause artifact for §1.** `convex/admin.ts:335` still declares the flat
   `StudentWithSessionInfo` type with zero remaining usages, immediately below the comment
   `// Removed legacy mentee-named endpoint`. The route was written against that deleted query's shape.
   Delete the orphan type in the same PR so the mismatch cannot regress.

5. **Blast radius.** `getStudentsForAdmin` is also called by
   `apps/web/app/api/admin/students/route.ts`. Option A (new query) and Option B (flatten inside the
   platform route) both leave the shared query untouched; changing the query's return shape does not.

6. **Sequencing trap.** `getStats` counts *active session packs*, which is a fourth candidate
   definition of `activeStudentCount` alongside §1.4's three. Wire §2 only after the canonical
   definition is applied, otherwise the dashboard contradicts the surface it links to.

7. **Process cost.** Per `AGENTS.md`, each PR needs Greptile (primary) and ideally CodeRabbit, and any
   change to a Convex query consumed by more than one app needs a Linear post-merge verification issue.
   This is why the brief's Batch 1 is split into `1a` (UI only) and `1b` (API/route only).

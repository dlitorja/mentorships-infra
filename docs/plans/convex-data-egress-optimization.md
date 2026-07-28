# Convex Data Egress Optimization — Scope of Work

Tracking the rollout of fixes to reduce **Convex Data Egress** in `apps/platform`. The workspace page is the dominant egress hotspot because it mounts several large, unbounded, live Convex subscriptions that re-push their full result sets on every write.

## Problem summary

- **Data Egress** is the only free-tier threshold being approached because it measures bytes pushed from Convex to clients.
- **Workspace subscriptions** (`getWorkspaceMessages`, `getWorkspaceNotes`, `getWorkspaceImages`, `getWorkspaceLinks`) are unbounded and reactive; every chat message, image upload, note auto-save, or link share causes the full result set to be re-pushed to every participant.
- The **chat subscription is hoisted** in `workspace-client-page.tsx` so it stays active across all tabs, even when the user is not on the chat tab.
- **React Query defaults** keep subscriptions alive for 60 minutes and refetch on every window focus / mount, multiplying the bytes sent.
- **Export polling** runs every 2 seconds while an export is pending.

## Goal

Reduce Convex Data Egress by 60–80% by:

1. Paginating the chat, notes, images, and links subscriptions.
2. Splitting note list data from full note content.
3. Scoping the chat subscription to the chat tab.
4. Tuning React Query defaults to avoid unnecessary refetches.
5. Capping or paginating instructor/admin listing queries.

## Bundling strategy

PRs are grouped by the smallest surface that can be verified end-to-end. Each PR is independent unless noted.

| PR | Theme | Why bundled | Risk |
|---|---|---|---|
| **1** | Paginate workspace chat and scope subscription | Single biggest egress hotspot; changes one query + one page | P0 — chat is the core feature and the subscription is currently hoisted |
| **2** | Paginate workspace notes and split list/content | Notes are the second largest workspace subscription; requires UI changes | P1 — note list and composer behavior change |
| **3** | Paginate workspace images and links | Same workspace tab pattern as PR 2; can be verified independently | P1 — gallery and link list UX change |
| **4** | Tune React Query defaults and replace export polling | Cross-cutting but self-contained; reduces egress for all remaining queries | P1 — may affect perceived freshness across the app |
| **5** | Cap/paginate instructor and admin listings | Reduces egress on instructor dashboard and admin pages | P2 — lower frequency than workspace subscriptions |

---

## PR 1: Paginate workspace chat and scope subscription to the chat tab

**Branch:** `fix/convex-egress-chat-pagination`

**Goal:** stop sending the entire chat history on every message.

### Scope

1. **Add pagination to `getWorkspaceMessages`** in `convex/workspaces.ts`.
   - Use `take` + cursor-based pagination (e.g., `cursor` argument using `_creationTime` / `_id`).
   - Return the most recent N messages by default (e.g., 50), with an option to load older messages.
   - Ensure the index supports the pagination order (`by_workspaceId` with `order("desc")` or a new index if needed).

2. **Remove the hoisted chat subscription** in `apps/platform/components/workspace/workspace-client-page.tsx`.
   - Stop calling `useWorkspaceMessages` at the top-level `WorkspaceContent`.
   - Remove the `ChatDataProvider` wrapper from `workspace-client-page.tsx`.
   - Keep the chat data context but populate it inside `WorkspaceChat` instead.

3. **Subscribe inside `chat.tsx`**.
   - Call `useWorkspaceMessages` with the paginated query.
   - Implement "load older messages" scroll/button behavior.
   - Maintain the call-overlay chat behavior: the chat panel shown during a call must still receive new messages reactively. The `ChatDataProvider` can still be used, but the data source should be the paginated subscription inside `WorkspaceChat`.

4. **Update the chat mutation hook** in `apps/platform/lib/queries/convex/use-workspaces.ts`.
   - Adjust `useWorkspaceMessages` to accept pagination arguments.
   - Ensure new messages are appended to the local cache correctly instead of invalidating the entire list.

### Verification

- [ ] Chat loads the last 50 messages and paginates older messages on scroll.
- [ ] Sending a new message appends it locally without re-fetching the entire history.
- [ ] Chat remains reactive during a video call in the call-overlay panel.
- [ ] Switching between tabs does not keep a chat subscription alive.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` reports no new issues.
- [ ] Greptile review passes.

### Risks and mitigations

- **Call-overlay chat may miss messages**: ensure the call-overlay reuses the same `ChatDataProvider` or the same query hook instance.
- **Scroll behavior**: test both desktop and mobile scroll-to-bottom behavior after loading older messages.

---

## PR 2: Paginate workspace notes and split list from content

**Branch:** `fix/convex-egress-notes-pagination`

**Goal:** reduce the note subscription payload by returning only metadata in the list and full content only when a note is selected.

### Scope

1. **Add a paginated note list query** in `convex/workspaces.ts`.
   - `getWorkspaceNotes` should return only `_id`, `title`, `updatedAt`, `createdBy`, `sessionId`, `isLiveSessionNote`, and `deletedAt` (a metadata-only shape).
   - Add a new query `getWorkspaceNoteById` that returns the full `content` (TipTap HTML) for a selected note.
   - Use `take` + cursor pagination for the list (e.g., 50 notes).

2. **Update the `notes.tsx` component** in `apps/platform/components/workspace/notes.tsx`.
   - Load the list via the paginated metadata query.
   - Fetch full note content only when a note is selected.
   - Implement auto-save against the selected note; it should not re-fetch the entire note list on every keystroke.

3. **Update live session note handling**.
   - `getLiveSessionNote` can remain a small query; it already returns a single row.
   - Ensure the live note is surfaced without subscribing to the full note list.

### Verification

- [ ] Notes list loads metadata for the last 50 notes and paginates older notes.
- [ ] Selecting a note fetches its full `content`.
- [ ] Auto-save does not re-push the entire note list.
- [ ] Live session note still appears at the top of the notes list.
- [ ] `npm run typecheck` and `npm run lint` pass.
- [ ] Greptile review passes.

### Risks and mitigations

- **Note selection UX**: add a loading state for the note content while it is fetched.
- **Auto-save debounce**: keep the existing debounce; only the selected note subscription should be updated.

---

## PR 3: Paginate workspace images and links

**Branch:** `fix/convex-egress-images-links-pagination`

**Goal:** stop sending the full image and link arrays for a workspace on every upload or change.

### Scope

1. **Paginate `getWorkspaceImages`** in `convex/workspaces.ts`.
   - Return the most recent images first (e.g., 24 at a time).
   - Include a cursor for pagination.
   - Avoid returning URLs for images that are not visible; the existing `getUrl` calls are fine but the array should be bounded.

2. **Paginate `getWorkspaceLinks`** in `convex/workspaces.ts`.
   - Return the most recent links first (e.g., 50 at a time).
   - Include a cursor for pagination.

3. **Update `images.tsx`** in `apps/platform/components/workspace/images.tsx`.
   - Implement infinite scroll or "load more" for images.
   - Keep the bulk-export flow working.

4. **Update `links.tsx`** in `apps/platform/components/workspace/links.tsx`.
   - Implement infinite scroll or "load more" for links.

5. **Cap `getCallRecordingsForWorkspace`**.
   - If not already capped, reduce the limit to a reasonable number (e.g., 20) and add pagination if needed.

### Verification

- [ ] Images tab loads 24 images initially and loads more on request.
- [ ] Links tab loads 50 links initially and loads more on request.
- [ ] Uploading a new image or link appends locally without re-fetching the entire list.
- [ ] Workspace export still finds all images/links for the export (note: export may need a separate unbounded internal query since it is a one-off operation).
- [ ] `npm run typecheck` and `npm run lint` pass.
- [ ] Greptile review passes.

### Risks and mitigations

- **Export completeness**: `getWorkspaceExportData` is used for one-off exports and may need to remain unbounded or use a separate internal query. This is acceptable because it is not a live subscription.
- **Image URL expiry**: Convex file URLs expire; ensure pagination does not cache stale URLs.

---

## PR 4: Tune React Query defaults and replace export polling

**Branch:** `fix/convex-egress-query-tuning`

**Goal:** reduce the amplification of every subscription push by tuning React Query and replacing the 2-second export poll.

### Scope

1. **Tune `apps/platform/lib/providers/query-provider.tsx`**.
   - Increase `staleTime` to a longer value (e.g., 5 minutes) for Convex-backed queries.
   - Reduce `gcTime` to a shorter value (e.g., 5 minutes) so unused subscriptions are cleaned up sooner.
   - Set `refetchOnWindowFocus: false` for Convex-backed queries.
   - Set `refetchOnMount: false` for Convex-backed queries.
   - Keep retry behavior unchanged.

2. **Replace `useWorkspaceExports` polling** in `apps/platform/lib/queries/convex/use-workspaces.ts`.
   - Remove the `refetchInterval: 2000` polling.
   - Use a reactive query that watches the `workspaceExports` table directly.
   - The `getWorkspaceExports` query already returns the 10 most recent exports; make sure it is used as a live subscription.

3. **Audit other `refetchInterval` usages**.
   - Search the app for any other polling patterns and either remove them or use a reactive query.

### Verification

- [ ] Window focus no longer triggers a full refetch of all active Convex subscriptions.
- [ ] Switching tabs no longer re-fetches subscriptions if the data is within `staleTime`.
- [ ] Export status updates without polling.
- [ ] The UI still feels fresh; no stale data is shown when returning to the app after a long period.
- [ ] `npm run typecheck` and `npm run lint` pass.
- [ ] Greptile review passes.

### Risks and mitigations

- **UI staleness**: test across the main user flows (chat, notes, dashboard, sessions) to ensure no critical UI feels stale.
- **Mutations still invalidate**: ensure all mutations still call `queryClient.invalidateQueries` for the correct query keys so the UI updates after writes.

---

## PR 5: Cap and paginate instructor/admin listings

**Branch:** `fix/convex-egress-listing-caps`

**Goal:** reduce egress from instructor dashboard, admin pages, and public listings.

### Scope

1. **`convex/seatReservations.ts`** — `getInstructorStudentsWithRemainingSessions`.
   - Add pagination or a reasonable cap.
   - Avoid loading every seat reservation and session pack into memory.

2. **`convex/sessions.ts`** — `getInstructorAllSessions`.
   - Reduce the limit from 100 to a smaller default (e.g., 20) with pagination.

3. **`convex/instructors.ts`** — public listing queries.
   - Cap `getPublicInstructors`, `getActiveInstructors`, and `listInstructors`.
   - Avoid returning full instructor portfolios; return only the fields needed for the listing.

4. **`convex/users.ts`** — `listUsers`, `listActiveUsers`, `listDeletedUsers`.
   - Add pagination.
   - Avoid returning full user file lists in listing queries.

5. **Update UI consumers** in `apps/platform/app/instructor/dashboard/page.tsx`, `app/instructor/sessions/page.tsx`, and admin pages.
   - Add pagination UI.
   - Ensure search/filter still works client-side or move filtering server-side.

### Verification

- [ ] Instructor dashboard loads without an unbounded student list.
- [ ] Instructor sessions page paginates sessions.
- [ ] Public instructor listing pages paginate.
- [ ] Admin user lists paginate.
- [ ] `npm run typecheck` and `npm run lint` pass.
- [ ] Greptile review passes.

### Risks and mitigations

- **Dashboard aggregation**: if the instructor dashboard needs totals, consider computing them in a scheduled function or storing them on the instructor/session pack rows instead of aggregating on every query.
- **Search/filter UX**: decide whether search is server-side or client-side. Large lists should be server-side.

---

## Cross-cutting reminders

- **Naming conventions**: never use `mentor` or `mentee` in code. Use `instructor` and `student`.
- **Convex source of truth**: instructor data lives in Convex; do not move these queries to Supabase.
- **Schema changes**: follow `widen-migrate-narrow` if any new indexes are needed.
- **Clerk**: do not modify Clerk configuration or environment variables without explicit approval.
- **Greptile**: run `npx greptile@latest review` before opening each PR and again after addressing feedback.
- **Secrets**: never include API keys, tokens, or connection strings in commit messages or PR bodies.

---

## Progress tracker

| PR | Branch | Status | Merged | Notes |
|---|---|---|---|---|
| 1 | `fix/convex-egress-chat-pagination` | Not started | — | Highest expected impact |
| 2 | `fix/convex-egress-notes-pagination` | Not started | — | Independent of PR 1 |
| 3 | `fix/convex-egress-images-links-pagination` | Not started | — | Independent of PR 1/2 |
| 4 | `fix/convex-egress-query-tuning` | Not started | — | Can be done in parallel with PR 1–3 |
| 5 | `fix/convex-egress-listing-caps` | Not started | — | Independent of PR 1–4 |

*Last updated: 2026-07-28*

---

## One-paragraph summaries for future sessions

### PR 1: Paginate workspace chat
Add cursor-based pagination to `getWorkspaceMessages`, remove the top-level hoisted chat subscription in `workspace-client-page.tsx`, and subscribe to chat only inside the chat tab. Keep the call-overlay chat reactive by populating the `ChatDataProvider` from the paginated query inside `WorkspaceChat`.

### PR 2: Paginate workspace notes
Split `getWorkspaceNotes` into a metadata-only paginated list and a `getWorkspaceNoteById` detail query. Update the Notes tab to load the list first and fetch full TipTap content only when a note is selected, so auto-save does not re-push the entire note list.

### PR 3: Paginate workspace images and links
Add cursor-based pagination to `getWorkspaceImages` and `getWorkspaceLinks`, cap `getCallRecordingsForWorkspace`, and update the Images and Links tabs with "load more" behavior. Keep export queries separate since they are one-off operations.

### PR 4: Tune React Query defaults
Increase `staleTime`, reduce `gcTime`, and disable `refetchOnWindowFocus` / `refetchOnMount` for Convex-backed queries in `query-provider.tsx`. Replace the 2-second `useWorkspaceExports` polling with a live reactive query.

### PR 5: Cap and paginate instructor/admin listings
Add pagination or caps to `getInstructorStudentsWithRemainingSessions`, `getInstructorAllSessions`, public instructor listings, and admin user lists. Update the instructor dashboard and admin pages to support pagination.

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

### Status

Merged via [PR #700](https://github.com/dlitorja/mentorships-infra/pull/700). `npm run typecheck` and `npm run lint` pass; Greptile review passed at 5/5 confidence.

### Scope (as implemented)

1. **Add a new paginated query `getWorkspaceMessagesPaginated`** in `convex/workspaces.ts`.
   - Uses `paginationOptsValidator` and `.paginate()` on the existing `by_workspaceId` index with `order("desc")` so the first page is the most recent messages.
   - Returns an empty, done page for non-participants.
   - Keeps the legacy `getWorkspaceMessages` unbounded query for `apps/web`, which is not in this PR's scope.

2. **Keep the `ChatDataProvider` hoisted** in `apps/platform/components/workspace/workspace-client-page.tsx`.
   - The provider still owns the chat subscription so the call-overlay chat panel stays reactive across tab/call mount churn.
   - The subscription is now the paginated `useWorkspaceMessagesPaginated` instead of the unbounded `useWorkspaceMessages`, so only the most recent 50 messages are pushed on every write.
   - The provider value now includes `status` and a stable `loadMore` wrapper (ref + `useCallback`) so the context value does not churn on every render.

3. **Update `chat.tsx`**.
   - Consume the paginated results from the provider (or fall back to a local `useWorkspaceMessagesPaginated` when rendered outside the provider).
   - Reverse the newest-first server results for chronological display.
   - Add a "Load older messages" button at the top of the list.
   - Update auto-scroll so it jumps to the bottom on first load and when a new message arrives while the user is already near the bottom, but preserves scroll position when older pages are loaded.
   - Clear the `lastMessageIdRef` and `scrollBeforeLoadRef` scroll anchors on workspace switch so a stale snapshot does not jump the new workspace's chat.

4. **Add a server-side file count query**.
   - Add a `by_workspaceId_type_senderRole` index and a `getWorkspaceFileCounts` query in `convex/workspaces.ts`.
   - Add `useWorkspaceFileCounts` in `apps/platform/lib/queries/convex/use-workspaces.ts`.
   - Replace the client-side `currentFileCount` slice in `chat.tsx` with the server-side count so the remaining-file-slots indicator is accurate regardless of how many chat pages are loaded.

5. **Remove unnecessary `getWorkspaceMessages` invalidations** in `apps/platform/lib/queries/convex/use-workspaces.ts`.
   - The paginated subscription is reactive, so new messages appear automatically. Explicit invalidation would reset the pagination state and re-fetch the full first page.
   - Removed from `useCreateWorkspaceMessage`, `useCreateWorkspaceImageAndMessage`, `useCreateWorkspaceFileMessage`, and `useShareResourceToChat`.

### Verification

- [x] Chat loads the last 50 messages and paginates older messages via the "Load older messages" button.
- [x] Sending a new message appears in the list without re-fetching the entire history.
- [x] Chat remains reactive during a video call in the call-overlay panel (provider still owns the subscription).
- [x] File upload slot indicator uses server-side `getWorkspaceFileCounts` and stays accurate regardless of loaded chat history.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` reports no new errors (128 pre-existing warnings remain on main).
- [x] Greptile review passed at 5/5 confidence.

### Risks and mitigations

- **Call-overlay chat may miss messages**: mitigated by keeping the `ChatDataProvider` hoisted at the `WorkspaceContent` level.
- **Scroll behavior**: auto-scroll only fires when the newest message changes and the user is already near the bottom, so loading older history does not yank the user away.
- **apps/web still uses unbounded query**: `apps/web` continues to use `useWorkspaceMessages`/`getWorkspaceMessages` and is out of scope for this PR.
- **File quota accuracy**: the file-slot UI uses a dedicated `getWorkspaceFileCounts` query backed by the `by_workspaceId_type_senderRole` index. This matches the pre-PR client-side count (which also only counted file messages whose `senderRole` matched the caller's role), so legacy file messages with an undefined `senderRole` are still not counted. The server enforces the real cap on new uploads, so quota enforcement is not loosened.

---

## PR 2: Paginate workspace notes and split list from content

**Branch:** `fix/convex-egress-notes-pagination`

**Goal:** reduce the note subscription payload by returning only metadata in the list and full content only when a note is selected.

### Status

Merged via [PR #702](https://github.com/dlitorja/mentorships-infra/pull/702). `npx tsc --noEmit -p convex/tsconfig.json`, `pnpm --filter @mentorships/platform typecheck`, `pnpm --filter @mentorships/platform lint`, and `CI=true npm run test:convex` (37 tests) pass; Greptile review passed at 5/5 confidence.

### Scope (as implemented)

1. **Add a paginated note list query** in `convex/workspaces.ts`.
   - Added `getWorkspaceNotesPaginated`, which returns only `_id`, `title`, `updatedAt`, `createdBy`, `sessionId`, `isLiveSessionNote`, and `deletedAt` (a metadata-only shape) and uses `paginationOptsValidator` with the existing `by_workspaceId_and_deletedAt` index.
   - Added `getWorkspaceNoteById` to return the full note, including TipTap `content`, for a selected note; guards against soft-deleted notes.
   - Kept the legacy `getWorkspaceNotes` unbounded query in place for `apps/web` and other consumers not in this PR's scope.

2. **Update the `notes.tsx` component** in `apps/platform/components/workspace/notes.tsx`.
   - Load the list via `useWorkspaceNotesPaginated` (50 notes initially, newest-first).
   - Fetch full note content only when a note is selected via `useWorkspaceNoteById`.
   - Show a loading state while the selected note content loads.
   - Added a "Load more notes" button at the bottom of the notes sidebar.
   - Removed the `refetch()` call after creating/deleting notes; the paginated subscription is reactive.
   - Added a `pendingDeletedNoteId` state to prevent the auto-selection effect from reselecting a note while the deletion is propagating through the reactive subscription.

3. **Update live session note handling**.
   - `getLiveSessionNote` remains unchanged; it is already a single-row query.
   - The live session note is surfaced at the top of the notes list independently of the paginated list.

4. **Update the resource embed dialog** in `apps/platform/components/workspace/resources.tsx`.
   - The `EmbedNoteDialog` now uses `useWorkspaceNotesPaginated` instead of the unbounded `useWorkspaceNotes`.
   - Added a "Load more notes" button and a loading state for the initial note list.

5. **Remove unnecessary `getWorkspaceNotes` invalidations** in `apps/platform/lib/queries/convex/use-workspaces.ts`.
   - The paginated note list and the note detail query are reactive, so title/session changes, auto-saved content, and embedded resources appear automatically. Explicit invalidation would reset pagination state and re-fetch the first page unnecessarily.
   - Removed the invalidation from `useEmbedResourceInNote`; kept the `getWorkspaceImages` invalidation for PR 3.

### Verification

- [x] Notes list loads metadata for the last 50 notes and paginates older notes.
- [x] Selecting a note fetches its full `content`.
- [x] Auto-save does not re-push the entire note list.
- [x] Live session note still appears at the top of the notes list.
- [x] `npx tsc --noEmit -p convex/tsconfig.json` passes.
- [x] `pnpm --filter @mentorships/platform typecheck` passes.
- [x] `pnpm --filter @mentorships/platform lint` reports no new errors (122 pre-existing warnings remain).
- [x] `CI=true npm run test:convex` passes (37 tests).
- [x] Greptile review passed at 5/5 confidence.

### Risks and mitigations

- **Note selection UX**: a loading state is shown while the selected note content is fetched.
- **Auto-save debounce**: the existing debounce is kept; only the selected note detail subscription is updated on each auto-save.
- **Deleted note reselection**: `pendingDeletedNoteId` suppresses the auto-selection effect from picking the deleted note until the reactive subscription removes it.
- **Legacy `getWorkspaceNotes` consumers**: `apps/web` and other callers still use the unbounded query; migrate them in a future PR.

---

## PR 3: Paginate workspace images and links

**Branch:** `fix/convex-egress-images-links-pagination`

**Goal:** stop sending the full image and link arrays for a workspace on every upload or change.

### Scope

1. **PR 2 follow-up: fix note selection regression** in `apps/platform/components/workspace/notes.tsx`.
   - Add a `hasSelectedNoteBeenInListRef` to track whether the currently selected note has ever appeared in the loaded paginated list.
   - When a previously visible selected note disappears from `notes` (e.g., deleted by another participant), clear `selectedNoteId` so the existing auto-selection effect can reselect a surviving note.
   - Do **not** treat a newly created note that has not yet appeared in `notes` as deleted; preserve the `pendingDeletedNoteId` behavior.
   - Reset `selectedNoteId`, `pendingDeletedNoteId`, and the ref whenever `workspaceId` changes so state from a previous workspace does not leak into the next.

2. **Schema: add a `deletedAt` index for workspace links** in `convex/schema.ts`.
   - Add `by_workspaceId_and_deletedAt` to `workspaceLinks` (mirrors `workspaceNotes` and `workspaceImages`).
   - This is an additive index; no data migration is required.

3. **Paginate `getWorkspaceImages`** in `convex/workspaces.ts`.
   - Add `getWorkspaceImagesPaginated` (newest-first, 24 items/page) using `paginationOptsValidator` and the existing `by_workspaceId_and_deletedAt` index.
   - Perform role filtering and `ctx.storage.getUrl()` generation only on the returned page.
   - Return an empty, done page for non-participants.
   - Keep the legacy `getWorkspaceImages` unbounded query for `apps/web`.

4. **Paginate `getWorkspaceLinks`** in `convex/workspaces.ts`.
   - Add `getWorkspaceLinksPaginated` (newest-first, 50 items/page) using the new `by_workspaceId_and_deletedAt` index.
   - Exclude soft-deleted links server-side.
   - Return an empty, done page for non-participants.
   - Keep the legacy `getWorkspaceLinks` unbounded query for `apps/web`.

5. **Add paginated hooks** in `apps/platform/lib/queries/convex/use-workspaces.ts`.
   - Add `useWorkspaceImagesPaginated` and `useWorkspaceLinksPaginated` with the same return-type annotations as `useWorkspaceNotesPaginated`.
   - Use `useWorkspace(workspaceId)` in `images.tsx` and `chat.tsx` to read role-based image counters (`studentImageCount`, `instructorImageCount`) so the remaining-slots UI stays accurate without loading the full image list.

6. **Update `images.tsx`** in `apps/platform/components/workspace/images.tsx`.
   - Replace `useWorkspaceImages` with `useWorkspaceImagesPaginated`.
   - Add a "Load more images" button at the bottom of the grid.
   - Replace the client-side image-filter count with workspace counters from `useWorkspace`.
   - Keep the bulk-export flow unchanged (export uses the separate `getWorkspaceExportData` query).

7. **Update `links.tsx`** in `apps/platform/components/workspace/links.tsx`.
   - Replace `useWorkspaceLinks` with `useWorkspaceLinksPaginated`.
   - Add a "Load more links" button at the bottom of the list.
   - The "Shared during current call" subpanel (`useSharedLinksForActiveSession`) stays unchanged.

8. **Update `chat.tsx`** in `apps/platform/components/workspace/chat.tsx`.
   - Remove the `useWorkspaceImages` call that was only used for the image-slot count.
   - Use `useWorkspace(workspaceId)` to compute the remaining image slots from the workspace counters.

9. **Remove unnecessary invalidations** in `apps/platform/lib/queries/convex/use-workspaces.ts`.
   - The paginated image and link subscriptions are reactive, so new/deleted rows appear automatically. Explicit invalidation would reset pagination state and re-fetch the full first page.
   - Remove `getWorkspaceImages` invalidations from `useCreateWorkspaceImageAndMessage`, `useEmbedImageInNote`, `useShareResourceToChat`, and `useEmbedResourceInNote`.
   - Remove `getWorkspaceLinks` invalidations from `useCreateWorkspaceLink` and `useDeleteWorkspaceLink`.

10. **Cap `getCallRecordingsForWorkspace`** in `convex/sessions.ts`.
    - Reduce the `.take(200)` buffer to `.take(20)`.
    - Update the surrounding comment to reflect the new cap.
    - The `calls-section.tsx` and `calls-tab.tsx` consumers continue to use the query directly; full cursor-based pagination is left as a future follow-up if workspaces exceed 20 recordings.

### Verification

- [x] Note selection in `notes.tsx` handles external deletion and workspace switches (`typecheck`, `lint`, and `test:convex` pass).
- [ ] Images tab loads 24 images initially and loads more on request.
- [ ] Links tab loads 50 links initially and loads more on request.
- [ ] Uploading a new image or link appends locally without re-fetching the entire list.
- [ ] Image and link slot/count indicators remain accurate without loading the full list.
- [ ] Workspace export still finds all images/links for the export (export uses the one-off `getWorkspaceExportData` query).
- [ ] Calls/Videos tabs show up to 20 recordings.
- [ ] `npx tsc --noEmit -p convex/tsconfig.json` passes.
- [ ] `pnpm --filter @mentorships/platform typecheck` passes.
- [ ] `pnpm --filter @mentorships/platform lint` reports no new errors.
- [ ] `CI=true npm run test:convex` passes.
- [ ] Greptile review passes.

### Risks and mitigations

- **Export completeness**: `getWorkspaceExportData` is used for one-off exports and remains unbounded. This is acceptable because it is not a live subscription.
- **Image URL expiry**: `ctx.storage.getUrl()` is called only for the visible page, so URLs are refreshed as the user loads more.
- **Role-filtered page sizes**: `getWorkspaceImagesPaginated` filters by role after reading the page. In rare cases a student page may contain fewer visible images if many student-only images are loaded; the "Load more" button will fetch the next page.
- **Recording cap correctness**: the `.take(20)` is on `by_instructorId_studentId` ordered by `_creationTime`. If a session was created earlier than the 20th most recent session but started later, the UI may omit it. This is a known pre-existing trade-off; full pagination by `callStartedAt` is out of scope for this PR.

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
| 1 | `fix/convex-egress-chat-pagination` | Merged | [PR #700](https://github.com/dlitorja/mentorships-infra/pull/700) | typecheck/lint pass; Greptile 5/5 |
| 2 | `fix/convex-egress-notes-pagination` | Merged | [PR #702](https://github.com/dlitorja/mentorships-infra/pull/702) | typecheck/lint pass; Greptile 5/5 |
| 3 | `fix/convex-egress-images-links-pagination` | In progress | — | PR 2 follow-up note-selection fix already committed; images/links pagination in progress |
| 4 | `fix/convex-egress-query-tuning` | Not started | — | Can be done in parallel with PR 3 |
| 5 | `fix/convex-egress-listing-caps` | Not started | — | Independent of PR 1–4 |

*Last updated: 2026-07-29 after PR #702 merged; PR 3 planning updated*

---

## Remaining work summary

PRs 1 and 2 are merged. The next highest-impact work is PR 3 (workspace images and links), followed by PR 4 (React Query tuning / export polling), and PR 5 (instructor/admin listings). PRs 3–5 are independent of each other; PR 4 is cross-cutting and can be done in parallel with PR 3 or PR 5.

### Next: PR 3 — Paginate workspace images and links
Add a `by_workspaceId_and_deletedAt` index for `workspaceLinks`, add `getWorkspaceImagesPaginated` (24/page) and `getWorkspaceLinksPaginated` (50/page), and wire them into `apps/platform`. Replace the full-list image count in `chat.tsx` and `images.tsx` with workspace counters from `useWorkspace`. Remove now-redundant `getWorkspaceImages`/`getWorkspaceLinks` invalidations from mutations. Cap `getCallRecordingsForWorkspace` at 20 recordings. Keep export queries separate. Also include the PR 2 follow-up fix for note auto-selection regressions.

### PR 4 — Tune React Query defaults
Increase `staleTime`, reduce `gcTime`, and disable `refetchOnWindowFocus` / `refetchOnMount` for Convex-backed queries in `query-provider.tsx`. Replace the 2-second `useWorkspaceExports` polling with a live reactive query.

### PR 5 — Cap and paginate instructor/admin listings
Add pagination or caps to `getInstructorStudentsWithRemainingSessions`, `getInstructorAllSessions`, public instructor listings, and admin user lists. Update the instructor dashboard and admin pages to support pagination.

---

## One-paragraph summaries for future sessions

### PR 1: Paginate workspace chat
Add a new paginated `getWorkspaceMessagesPaginated` query (newest-first, 50 items/page) and wire it into `apps/platform` via `useWorkspaceMessagesPaginated`. Keep the `ChatDataProvider` hoisted at `WorkspaceContent` so the call-overlay chat stays reactive, but replace the unbounded `getWorkspaceMessages` subscription with the paginated one. Stabilise the `loadMore` callback with a ref + `useCallback` so the context value does not churn on every render. Update `WorkspaceChat` to reverse the newest-first results for chronological display, add a "Load older messages" button, preserve scroll position when loading older history, and clear the scroll anchors when the workspace changes. Remove `getWorkspaceMessages` invalidations from message/file/resource mutations because the paginated subscription is reactive. Add a server-side `getWorkspaceFileCounts` query backed by the `by_workspaceId_type_senderRole` index so the chat file-slot indicator stays accurate without loading the full chat history; note that legacy file messages with an undefined `senderRole` remain uncounted, matching the pre-PR client-side count. Leave the legacy `getWorkspaceMessages` in place for `apps/web`.

### PR 2: Paginate workspace notes
Add a new paginated `getWorkspaceNotesPaginated` query in `convex/workspaces.ts` that returns only metadata (`_id`, `title`, `updatedAt`, `createdBy`, `sessionId`, `isLiveSessionNote`, `deletedAt`) and add `getWorkspaceNoteById` for the full TipTap `content`. Update the `apps/platform` Notes tab to subscribe to the paginated list (50 notes initially, newest-first) and fetch content only after a note is selected. Add a per-note loading state, a "Load more notes" button, and a `pendingDeletedNoteId` guard so the auto-selection effect does not reselect a note while the deletion is still propagating through the reactive subscription. Update the resource `EmbedNoteDialog` to use the paginated hook and show a loading state. Remove `getWorkspaceNotes` invalidations from note-related mutations because the paginated list and detail query are reactive. Leave the legacy `getWorkspaceNotes` query in place for `apps/web`.

### PR 3: Paginate workspace images and links
Add a `by_workspaceId_and_deletedAt` index for `workspaceLinks`, then add `getWorkspaceImagesPaginated` and `getWorkspaceLinksPaginated` (newest-first, 24 and 50 per page) and wire them into `apps/platform` via `useWorkspaceImagesPaginated` and `useWorkspaceLinksPaginated`. Replace the full-list image count in `chat.tsx` and `images.tsx` with workspace counters from `useWorkspace`. Remove the now-redundant `getWorkspaceImages` and `getWorkspaceLinks` invalidations from image/link/resource mutations. Cap `getCallRecordingsForWorkspace` at 20 recordings. Keep the one-off `getWorkspaceExportData` unbounded. Also include the PR 2 follow-up: fix the Notes tab auto-selection so it detects when a previously selected note disappears from the loaded list (external deletion) and reselects a survivor, while not treating a newly created note that has not yet appeared as deleted, and reset selection state on workspace switch.

### PR 4: Tune React Query defaults
Increase `staleTime`, reduce `gcTime`, and disable `refetchOnWindowFocus` / `refetchOnMount` for Convex-backed queries in `query-provider.tsx`. Replace the 2-second `useWorkspaceExports` polling with a live reactive query.

### PR 5: Cap and paginate instructor/admin listings
Add pagination or caps to `getInstructorStudentsWithRemainingSessions`, `getInstructorAllSessions`, public instructor listings, and admin user lists. Update the instructor dashboard and admin pages to support pagination.

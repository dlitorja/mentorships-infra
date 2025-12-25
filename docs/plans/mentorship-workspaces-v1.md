---
name: Mentorship Workspaces v1
overview: Implement global, mentor↔mentee workspaces for shared notes/links/images, with per-role upload caps, 18-month retention after mentorship end (seat released), async ZIP export (images+JSON), onboarding image import, and observability; defer Meilisearch indexing until the core workflow is stable.
todos:
  - id: schema-workspaces
    content: Add Drizzle schema for mentorship_workspaces + workspace content tables; add seat_reservations.releasedAt; remove/migrate sessions.notes; generate migrations + RLS.
    status: pending
  - id: api-workspaces
    content: Implement authenticated API routes for workspace list/detail; notes/links CRUD; images upload/list/delete (mime+4MB validation, caps); export trigger/status; signed URL helpers.
    status: pending
    dependencies:
      - schema-workspaces
  - id: ui-global-nav-workspaces
    content: "Add global Workspaces navigation + pages: workspaces list and workspace detail (notes/links/images, banner, export CTA). Add deep links from sessions/calendar/dashboard."
    status: pending
    dependencies:
      - api-workspaces
  - id: inngest-export-retention
    content: Implement Inngest jobs for async ZIP export (images + JSON) and daily retention notices/deletion (mentee-only notices; delete all content at 18 months after seat releasedAt).
    status: pending
    dependencies:
      - schema-workspaces
      - api-workspaces
  - id: onboarding-import-cleanup
    content: Import onboarding images into workspace on submit and then delete onboarding storage objects + clear onboarding image rows (or mark deleted).
    status: pending
    dependencies:
      - schema-workspaces
      - api-workspaces
  - id: observability-hooks
    content: Add observability events for upload/export/retention/deletion paths using existing observability utilities; ensure no sensitive data logged.
    status: pending
    dependencies:
      - api-workspaces
      - inngest-export-retention
---

# Mentorship Workspaces v1 (Global Access + Notes/Links/Images + Retention/Export)

## Outcome

Deliver a **first-class Mentorship Workspace** that is accessible from **any authenticated page**, scoped to a **mentor↔mentee pair**, and supports:

- Workspace **notes** (author editable; both readable)
- Workspace **links** (plain URLs; pinning later)
- Workspace **images** (mentor cap 150, mentee cap 75; jpg/png/webp; ≤4MB)
- **Download all data**: a single ZIP containing **all images + JSON export** of notes/links/metadata
- **Retention**: delete **all workspace content** (notes/links/images) **18 months after mentorship ends**, where mentorship end = **seat reservation released**; email notices to **mentee only** at **90/30/7 days** + in-app banner
- **Onboarding import**: copy onboarding images into the workspace on submit, then delete onboarding rows/objects
- **Observability**: log/track exports, retention notices, deletions, and failures

## Key decisions (locked)

- **Workspace identity**: `mentorship_workspaces` keyed by `(mentorId, menteeUserId)` where mentee is **Clerk user ID**.
- **Navigation**: add a global nav item `Workspaces` that leads to a **workspaces list page**.
- **Session notes legacy**: stop using session-specific `sessions.notes` (alpha env, safe to remove/migrate). Notes live in workspace.

## Design (data model)

### New tables (Drizzle)

Create in `packages/db/src/schema/`:

- `mentorship_workspaces`
- `id` (uuid)
- `mentorId` (uuid)
- `menteeUserId` (text, Clerk user ID)
- `createdAt`, `updatedAt`
- Uniqueness: `(mentorId, menteeUserId)`
- `workspace_notes`
- `id`, `workspaceId`, `authorUserId`, `content`, optional `pinnedAt`, `createdAt`, `updatedAt`, optional `deletedAt`
- `workspace_links`
- `id`, `workspaceId`, `authorUserId`, `url`, optional `pinnedAt`, `createdAt`, `updatedAt`, optional `deletedAt`
- `workspace_images`
- `id`, `workspaceId`, `authorUserId`, `authorRole`, `path`, `mimeType`, `sizeBytes`, `createdAt`, `updatedAt`, optional `deletedAt`
- `workspace_exports`
- `id`, `workspaceId`, `requestedByUserId`, `status`, `exportPath`, `createdAt`, `readyAt`, `expiresAt`, optional `error`
- `workspace_retention_notifications` (or equivalent)
- `id`, `workspaceId`, `noticeType` (90/30/7), `sentAt`, unique `(workspaceId, noticeType)` per retention window

### Existing table changes

- `seat_reservations`: add `releasedAt` timestamp (set when status transitions to `released`) to anchor retention.
- `sessions`: remove `notes` column usage; optionally remove column entirely for alpha.

### RLS + auth rules

- Read: mentor or mentee tied to the `workspaceId` can read workspace notes/links/images.
- Write: only `authorUserId` can update/delete their own records.
- Upload caps enforced server-side (and optionally DB-side via counts).

## Storage

- Supabase Storage bucket: `mentorship_workspace_assets` (or similar)
- Object path includes `workspaceId` and `imageId` to keep deletions and exports clean
- Export bucket/path: `mentorship_workspace_exports/<workspaceId>/<exportId>.zip`

## APIs (Next.js)

Add under `apps/web/app/api/workspaces/`:

- `GET /api/workspaces` (list workspaces for current user)
- `GET /api/workspaces/[workspaceId]` (workspace header + membership)
- Notes: `POST/GET/PATCH/DELETE /api/workspaces/[workspaceId]/notes`
- Links: `POST/GET/PATCH/DELETE /api/workspaces/[workspaceId]/links`
- Images:
- `POST /api/workspaces/[workspaceId]/images` (multipart upload; validate mime+size; enforce caps)
- `GET /api/workspaces/[workspaceId]/images` (list + signed URLs)
- `DELETE /api/workspaces/[workspaceId]/images/[imageId]`
- Export:
- `POST /api/workspaces/[workspaceId]/export` (enqueue Inngest job)
- `GET /api/workspaces/[workspaceId]/export/latest` (status + signed URL)

## UI

- Global nav: add `Workspaces` link for all authenticated users.
- New pages:
- `apps/web/app/workspaces/page.tsx`: list of workspaces (mentor/mentee label, last activity)
- `apps/web/app/workspaces/[workspaceId]/page.tsx`: tabs for Notes/Links/Images + banners + export button
- Add convenient “Open workspace” shortcuts from:
- student sessions, instructor sessions
- (optionally) calendar page and dashboard cards

## Background jobs (Inngest)

- `workspace/export.requested` → create ZIP (images + JSON export) and store in exports bucket; mark ready; report to observability.
- Daily retention job:
- Find workspaces whose mentorship ended (`seat_reservations.status=released` for that mentor+mentee pair) and compute `deleteAt = releasedAt + 18 months`.
- If within 90/30/7 windows and not sent: emit `notification/send` to mentee only.
- At/after deleteAt: delete Storage objects and soft-delete DB records.
- Onboarding import job/step:
- On onboarding submit: copy onboarding images into the workspace assets bucket and insert as `workspace_images`.
- Delete onboarding submission image objects/rows after successful import.

## Observability

- Log structured events (Axiom/Better Stack) for:
- uploads (success/failure)
- export requested/ready/failed
- retention notices sent
- deletion executed (counts)

## Meilisearch (deferred)

- Implement after core CRUD is stable:
- Index `workspace_notes` + `workspace_links` (and optionally image metadata)
- Add search box to workspace page

## Files likely to change

- `packages/db/src/schema/*`
- `packages/db/src/lib/queries/*`
- `apps/web/components/navigation/protected-layout.tsx` (or nav component used globally)
- `apps/web/app/workspaces/*`
- `apps/web/app/api/workspaces/*`
- `apps/web/inngest/functions/*` (new: `workspaces.ts`)
- `apps/web/lib/supabase-admin.ts` (reuse)

## Implementation todos
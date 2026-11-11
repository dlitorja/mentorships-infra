# Workspace & onboarding artwork exports

How the "download" surfaces for workspace tabs and onboarding artwork
are wired, and why each one uses the pieces it does.

The single rule shared by every export here: **nothing is stored in or
streamed through Convex storage.** Objects already live in the
workspace Backblaze B2 bucket, and generated archives are written back
to that same bucket. That keeps the Convex free-plan storage quota out
of the picture and keeps egress on B2 (which does not bill egress for
most tiers).

## Onboarding artwork (instructor review)

Reviewer flow:

1. Instructor sees submitted questionnaires in
   `/instructor/onboarding` and opens one (`/onboarding/<onboardingId>`).
2. The review card renders `WorkExampleGallery`
   (`apps/platform/components/onboarding/work-example-gallery.tsx`):
   - thumbnails mint a short-lived signed GET URL per image through
     `GET /api/onboarding/<id>/work-examples/<exampleId>/download-url`
     (auth re-checked on every call),
   - clicking a tile opens a full-size lightbox (arrow keys / Escape
     supported),
   - the per-image download button re-mints the same URL with
     `?download=1`, which adds `Content-Disposition: attachment` to the
     signed request (the HTML `download` attribute is ignored for
     cross-origin B2 URLs),
   - "Download all (ZIP)" calls the Convex mutation
     `onboardingArtworkExports.createOnboardingArtworkExport`.
3. That mutation inserts a `pending` row in `onboardingArtworkExports`
   and schedules `exportActions.triggerOnboardingArtworkExportTask`.
   Convex mutations cannot perform network I/O, so the HTTP call to
   Trigger.dev lives in an internal action; it writes a failure back
   onto the row (with `errorMessage`) if Trigger rejects the request.
4. The task reads the active work-example keys from
   `POST /onboarding/artwork-export/data` (gated by `CONVEX_HTTP_KEY`),
   streams each object from `WORKSPACE_STORAGE_BUCKET_NAME` into an
   `archiver` ZIP, uploads it to
   `onboarding-exports/<onboardingId>/<timestamp>-artwork.zip`, and
   reports back through `POST /onboarding/artwork-export/update-status`
   with a 72-hour signed URL.
5. The gallery subscribes to `onboardingArtworkExports` (live Convex
   query), so the button flips to "Download all" as soon as the row is
   `completed` — no polling. Signed URLs last 72 hours; once
   `expiresAt` passes the gallery hides the stale link and offers
   "Download all (ZIP)" to rebuild.

Auth: the same gate as every other onboarding read — assigned student,
an assigned instructor, or admin/support
(`getAuthorizedOnboardingRow` in `convex/onboardingWorkExamples.ts`).
The requester's Clerk subject is derived from auth, never accepted from
the client.

## Workspace Images tab (ZIP)

`components/workspace/images.tsx` → `workspaces.createWorkspaceExport`
with `format: "zip"`, `scope: "images"` → Trigger task
`process-workspace-export`.

`GET /workspace/export/data` with `scope: "images"` returns **images
only** — no notes. `scope` absent (the legacy full-workspace ZIP) still
includes notes. Each image carries:

- `b2Key` (+ `fileName` derived from the key's last path segment) for
  B2-backed rows — the task reads the object directly with the S3 SDK;
- `imageUrl` for legacy `data:` / Convex-storage rows.

Both export data queries (`queries/http.getWorkspaceExportData` and
`getWorkspaceExport`) are `internalQuery`, so only the HTTP routes in
`convex/http.ts` (gated by `CONVEX_HTTP_KEY`) can read them. They carry
no per-workspace membership check of their own, so keeping them off the
public API surface matters.

The task writes `images/*` for the Images tab (`notes.md` is only added
for the legacy full-workspace scope) to `exports/<workspaceId>/...` in
the workspace bucket.

The tab exposes a single ZIP control: it reads **Export ZIP** until an
up-to-date archive exists, then **Download ZIP**. It goes back to
**Export ZIP** when the link expires or when the visible image set
changed after the archive was built (`getWorkspaceImageSetUpdatedAt`
covers uploads and soft deletions), so a saved ZIP is never offered as
if it covered content it predates or omits.

Freshness uses the timestamp the worker recorded when it read the
images (`workspaceExports.sourceUpdatedAt`), not the row's
`_creationTime` — an upload that lands between "row created" and "data
read" is included in the archive, and the older row timestamp would
otherwise hide a perfectly current download. The download is also
withheld until the freshness query succeeds, so a cached old archive is
never offered before the check has run.

"Export selected" is a separate context: those rows carry
`selection: true`, are excluded from the header control, and surface
their own **Download selected ZIP** action in the selection bar.

The Links tab mirrors this exactly: the header's single CSV control
reads **Export CSV** until a current archive exists, then **Download
CSV**, and reverts to **Export CSV** when the link set changes
(`getWorkspaceLinkSetUpdatedAt`, uploads and soft deletions) or the
signature expires. `linkIds` on the mutation produces a
`selection: true` row, excluded from the header, with **Export
selected** / **Download selected CSV** in the selection bar.

Filenames are sanitized, de-duplicated (`sketch.png`, `sketch-2.png`),
and their extension comes from the stored content type — previously B2
rows landed in the archive as `image-1.bin` because the query only
returned a signed URL and no filename.

## Workspace Links tab (CSV)

`components/workspace/links.tsx` → `createWorkspaceExport` with
`format: "csv"`, `scope: "links"` → Trigger task
`process-workspace-links-export`.

- `GET /workspace/export/data` with `scope: "links"` returns only
  `workspaceName` + non-deleted `workspaceLinks` (newest first). Notes
  and images are not loaded.
- `@mentorships/storage`'s `generateLinksCsv` serialises
  `title,url,added_by,added_at,shared_in_call` with a UTF-8 BOM (Excel),
  RFC 4180 quoting, and formula-injection protection (cells starting
  with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'`).
- `added_by` is a human name resolved by `lib/authorDisplay`: the
  instructor profile's name for instructor authors, first + last name
  otherwise, falling back to `Student` / `Instructor` / `Admin`. Clerk
  ids and email addresses are never written to the CSV — a student can
  request the export, so the instructor's email must not leak.
- The CSV is written to `exports/<workspaceId>/<timestamp>-<name>-links.csv`
  and served through a 72-hour signed URL.

CSV (not ZIP) because the payload is tabular and small — a reviewer
opens it in Sheets/Excel directly.

Like the artwork mutation, `createWorkspaceExport` schedules
`exportActions.triggerWorkspaceExportTask` instead of calling
Trigger.dev inline.

## Artifact lifetime and cleanup

Generated exports are disposable, so they are deleted automatically
after **72 hours**:

- **B2 objects** — the Trigger.dev schedule `cleanup-export-artifacts`
  (`src/trigger/export-artifact-cleanup.ts`) runs hourly. It lists two
  dedicated namespaces — `exports/` (workspace ZIP/CSV) and
  `onboarding-exports/` (artwork ZIP) — and deletes anything older than
  72 hours in batches of 1,000. Uploaded artwork (`onboarding/<id>/…`)
  is never listed: its key embeds a student-supplied `fileId`, so it
  must stay outside the sweep's reach. Delete errors are retried on the
  next tick; the operation is idempotent.
  **The bucket has B2 versioning enabled**, so the sweep lists object
  *versions* (and delete markers) and deletes every version of an
  expired key — a plain `DeleteObject` would only add a delete marker
  and leave the bytes billed.
- **Convex rows** — the hourly cron `cleanup-expired-export-records`
  (`convex/exportMaintenance.ts`) deletes terminal
  (`completed`/`failed`) rows once their artifact has expired and marks
  any abandoned `pending`/`processing` row failed ("Export timed out…"),
  so a lost run does not leave a spinner forever. The next tick deletes
  the now-terminal row. Expiry is measured from `expiresAt` (completion +
  72h, written by the worker), not row creation, so a queued or slow
  export keeps its full window.
- **Signed URLs** use the same 72-hour window, so the UI stops offering
  a download as the object becomes eligible for deletion. `expiresAt`
  drives the "Previous ZIP/CSV expired" hint and the rebuild action.

The window lives in two mirrored constants
(`packages/storage/src/export-artifacts.ts` for the Trigger sweep,
`convex/workspaceConstants.ts` for the Convex cron). Keep them in sync.

## Onboarding artwork retention (6 months)

Uploaded questionnaire artwork (work examples) is deleted **six months
after upload**. This is a privacy commitment, not just a hidden row: the
B2 object is removed.

- `convex/workspaceConstants.ts:ONBOARDING_WORK_EXAMPLE_RETENTION_MS`
  (6 × 30 days) is the window; `apps/platform/lib/workspace-constants.ts`
  mirrors it for the UI copy.
- The Trigger schedule `cleanup-expired-onboarding-artwork`
  (`src/trigger/onboarding-artwork-retention.ts`) runs daily at 03:45
  UTC. It asks Convex (`POST /onboarding/work-examples/expired`, gated by
  `CONVEX_HTTP_KEY`) for the oldest live rows older than the window,
  deletes **every B2 version** of each key (the workspace bucket has
  versioning enabled), then calls
  `POST /onboarding/work-examples/mark-expired`.
- `listExpiredWorkExamples` includes `pending`, `active`, **and
  soft-deleted** rows without an `artifactDeletedAt` stamp: cancellation
  only hides a row, so its object is still in B2 and would otherwise
  linger. `markWorkExamplesExpired` writes the stamp (and hides the row
  if it was still visible). The stamp is part of the
  `by_status_artifactDeletedAt_uploadedAt` index, so cleaned rows never
  re-enter the scan.
- Upload keys use a **server-generated** `fileId`
  (`convex/onboardingWorkExamplesActions.ts`) so two uploads can never
  share a `b2Key`. For legacy rows that still collide, the expired row
  is returned with `sharedWithNewerLive: true`: the row is retired but
  the worker keeps the object for the newer upload that points at it.
  Flagging instead of skipping also means a run of shared keys cannot
  hide unrelated expired rows behind them.
- Object deletion is idempotent; a failed batch leaves its rows
  unstamped and the next daily run retries.
- Disclaimer copy (small muted text) is rendered to both audiences:
  students under the questionnaire's artwork grid, and reviewers
  (instructors and admins) under the artwork gallery.

## Export rows and scopes

`workspaceExports` rows carry an optional `scope` (`workspace` |
`images` | `links`) and the table has a `by_workspaceId_scope` index.
Each tab passes its scope to `getWorkspaceExports`, so it receives its
own 10 most recent rows — ten newer Links exports cannot push a valid
Images ZIP out of view. Rows created before `scope` existed are treated
as the full-workspace ZIP and appear on the Images tab.

`exportActions` failures are recorded with an `errorMessage`. A user
cancel writes `cancelledAt` instead, and the status writers treat that
marker as terminal. Cancellation deliberately does not rely on
"`failed` with no `errorMessage`": a retried task keeps the message
from its earlier attempt, and the old heuristic would let that retry
complete a cancelled export.

`(format, scope)` pairs are looked up in a task map in
`convex/workspaces.ts`; an unsupported pair marks the row `failed` with
an explicit message instead of leaving it `pending` forever.

## Environment variables

Trigger.dev project env (see `trigger.config.ts`):

- `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_HTTP_KEY`
- `B2_KEY_ID`, `B2_APPLICATION_KEY`
- `WORKSPACE_STORAGE_BUCKET_NAME` (required — exports never fall back to
  `B2_BUCKET_NAME`, which points at a different bucket)
- `CONVEX_SITE_URL` (optional; recommended). Convex **HTTP actions**
  live on `*.convex.site`, while `NEXT_PUBLIC_CONVEX_URL` points at
  `*.convex.cloud`. The export tasks prefer `CONVEX_SITE_URL` and
  otherwise rewrite `.convex.cloud` → `.convex.site` on the
  `NEXT_PUBLIC_CONVEX_URL` value. Without this rewrite every status
  update 404s and the row never leaves `processing`.

Convex env:

- `TRIGGER_SECRET_KEY` (or `TRIGGER_API_KEY`) — the mutations trigger
  tasks over the Trigger.dev REST API. Missing credentials surface as a
  failed row with a readable message rather than a stuck `pending`.

## Verification

Unit / integration:

```bash
npx vitest run --config convex/vitest.config.mjs \
  convex/workspaceExport.test.ts convex/onboardingArtworkExports.test.ts
npx vitest run --config vitest.config.mjs \
  packages/storage/src/export-csv.test.ts \
  apps/platform/components/onboarding/work-example-gallery.test.tsx
```

Manual (staging / preview):

1. Instructor opens a submitted onboarding → click a thumbnail (full
   size), then the download icon (file saves with the original name).
2. "Download all (ZIP)" → status moves `pending` → `processing` →
   `completed`; the archive contains `artwork/<original names>`.
3. Workspace → Images → "Export ZIP" → archive contains `images/*` with
   the original filenames and correct extensions.
4. Workspace → Links → "Export CSV" → file opens in a spreadsheet with
   one row per non-deleted link.

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
   and triggers the Trigger.dev task
   `process-onboarding-artwork-export`.
4. The task reads the active work-example keys from
   `POST /onboarding/artwork-export/data` (gated by `CONVEX_HTTP_KEY`),
   streams each object from `WORKSPACE_STORAGE_BUCKET_NAME` into an
   `archiver` ZIP, uploads it to
   `onboarding/<onboardingId>/exports/<timestamp>-artwork.zip`, and
   reports back through `POST /onboarding/artwork-export/update-status`
   with a 7-day signed URL.
5. The gallery subscribes to `onboardingArtworkExports` (live Convex
   query), so the button flips to "Download all" as soon as the row is
   `completed` — no polling.

Auth: the same gate as every other onboarding read — assigned student,
an assigned instructor, or admin/support
(`getAuthorizedOnboardingRow` in `convex/onboardingWorkExamples.ts`).
The requester's Clerk subject is derived from auth, never accepted from
the client.

## Workspace Images tab (ZIP)

`components/workspace/images.tsx` → `workspaces.createWorkspaceExport`
with `format: "zip"`, `scope: "images"` → Trigger task
`process-workspace-export`.

`GET /workspace/export/data` returns the notes plus, for each image:

- `b2Key` (+ `fileName` derived from the key's last path segment) for
  B2-backed rows — the task reads the object directly with the S3 SDK;
- `imageUrl` for legacy `data:` / Convex-storage rows.

The task wraps them into `notes.md` + `images/*` and writes the archive
to `exports/<workspaceId>/...` in the workspace bucket.

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
- The CSV is written to `exports/<workspaceId>/<timestamp>-<name>-links.csv`
  and served through a 7-day signed URL.

CSV (not ZIP) because the payload is tabular and small — a reviewer
opens it in Sheets/Excel directly.

## Export rows and scopes

`workspaceExports` rows carry an optional `scope` (`workspace` |
`images` | `links`). Each tab filters to its own scope via
`latestExportForScope`, so a Links CSV never shows up as the Images
tab's "Download ZIP" (and vice versa). Rows created before `scope`
existed are treated as the full-workspace ZIP and appear on the Images
tab.

`(format, scope)` pairs are looked up in a task map in
`convex/workspaces.ts`; an unsupported pair marks the row `failed` with
an explicit message instead of leaving it `pending` forever.

## Environment variables

Trigger.dev project env (see `trigger.config.ts`):

- `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_HTTP_KEY`
- `B2_KEY_ID`, `B2_APPLICATION_KEY`
- `WORKSPACE_STORAGE_BUCKET_NAME` (required — exports never fall back to
  `B2_BUCKET_NAME`, which points at a different bucket)

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

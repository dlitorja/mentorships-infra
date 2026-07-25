# Huckleberry Drive MVP - Implementation Plan

## Status

### MVP phases

| Phase | Status |
|-------|--------|
| Phase 1: Backend Schema & Convex Queries | ✅ Merged (PR #482, #479) |
| Phase 2: API Routes | ✅ Merged (PR #484) |
| Phase 3: Frontend Pages | ✅ Merged (PR #486 — fixes security, a11y, UX issues) |

### Post-MVP feature development (June–July 2026)

| PR | Date | Subject |
|----|------|---------|
| #521 | 2026-06-23 | user management with soft/hard delete |
| #524 | 2026-06-23 | dual-index user lookup for admin checks + seed-role endpoint |
| #525 | 2026-06-24 | missing sign-up page + Clerk webhook for invitation flow |
| #526 | 2026-06-24 | invitation sign-up flow + invitation deletion |
| #528 | 2026-06-24 | allow deletion of cancelled invitations |
| #541 | 2026-06-26 | resend invitation button |
| #566–#573 | 2026-06-28 | Clerk satellite domain + JWT issuer + middleware fixes (5 PRs) |
| #658 | 2026-07-20 | share uploaded files with other video editors |
| #664 | 2026-07-22 | add Share button to admin files page |
| #665 | 2026-07-23 | bug fixes, indexed reads, **storage limit OCC**, share creator preview |
| #666 | 2026-07-23 | drop student role + dead code |
| #667 | 2026-07-23 | **bulk download UI** — checkbox selection + ZIP polling |
| #668 | 2026-07-23 | **audit log for admin mutations** |

### Deferred (Post-MVP) items — status update

| # | Item | Original plan status | Now |
|---|------|----------------------|-----|
| 1 | ~~S3 archival automation~~ | Removed by design | **Removed** — B2-only storage ($0.006/GB/mo). No Glacier. |
| 2 | File preview / video playback | "No video player component, need to build inline player with B2 signed URL" | ✅ **Done in 3 places** — see [§ Post-MVP additions](#post-mvp-additions-2026) below |
| 3 | Bulk download as ZIP | "Partial code in `@mentorships/storage/src/zip.ts:createAndUploadZip`, need trigger task + API endpoint + frontend" | ✅ **Done in PR #667** — POST `/api/files/bulk-download` starts the Trigger.dev job; GET `/api/files/bulk-download/[jobId]` polls; frontend in `/admin/files` and `/dashboard` |
| 4 | Storage limit per-instructor enforcement at API level | "Currently only client-side display; need to add check to `POST /api/uploads/initiate` to prevent overages (race condition risk with concurrent uploads)" | ✅ **Done in PR #665** — authoritative 50GB limit enforced in Convex `createUpload` mutation with OCC catching concurrent uploads; route-side pre-check retained for nicer error messages |

---

## Phase 2: API Routes (Next.js) — ✅ Done (PR #484)

### 2.1 Update `GET /api/files` ✅

**File:** `apps/huckleberry-drive/src/app/api/files/route.ts`

Wire up `getAllUploads` Convex query to support admin's full file browsing with filters.

**Query params:**
- `?instructorId=X` — filter by instructor
- `?uploadedById=Y` — filter by uploader (video editor)
- `?status=deleted|completed|all` — filter by status
- `?search=filename` — filter by filename
- `?cursor=N&limit=50` — pagination

**Access control:**
- Instructors: see only their own uploads (default: non-deleted only)
- Video editors: see uploads they made (`uploadedById === userId`) (default: non-deleted only)
- Admins: see all uploads with any filters (no default status filter)

**Note:** Non-admin paths default to `status: "completed"` to exclude soft-deleted files unless explicitly requested with `?status=all` or `?status=deleted`.

### 2.2 Update `GET /api/storage-usage` ✅

**File:** `apps/huckleberry-drive/src/app/api/storage-usage/route.ts`

- `STORAGE_LIMIT_BYTES` updated from `20GB` → `50GB`
- Admin mode: aggregate storage across ALL instructors (uses `getTotalStorageStats`)
- Return `{ usedBytes, limitBytes: null, fileCount, instructorCount }` for admin

### 2.3 New `POST /api/files/[id]/restore` ✅

**File:** `apps/huckleberry-drive/src/app/api/files/[id]/route.ts` (POST method added)

- Calls Convex `restoreUpload` mutation
- Instructor can restore their own soft-deleted files
- Admin can restore any file
- Returns `{ success: true }` or `{ error: "grace_period_expired" }`

### 2.4 New `DELETE /api/files/[id]/hard` ✅

**File:** `apps/huckleberry-drive/src/app/api/files/[id]/hard/route.ts` (new file)

- Admin only (gate with `requireAdmin()`)
- Calls Convex `hardDeleteUpload` mutation
- Deletes from B2 + removes DB record
- Returns `200` if record deleted directly, `202` if async B2 deletion triggered

### 2.5 New `GET /api/admin/stats` ✅

**File:** `apps/huckleberry-drive/src/app/api/admin/stats/route.ts` (new file)

- Requires admin auth (`requireAdmin()`)
- Calls Convex `getAdminStats` query
- Returns `{ totalInstructors, totalFiles, totalBytes, activeFiles, activeBytes }`

---

## Phase 3: Frontend Pages — ✅ Done (PR #486)

**Note:** PR #486 fixes: admin/files page gets download action for active files and "Video Editor" label for uploadedById; dashboard video editor section gains per-section search + load-more pagination; file-list hard delete available without `onHardDelete` prop. Additional fixes applied post-review: `window.open` secured with `noopener,noreferrer`, icon buttons have `aria-label` attributes, video editor section uses section-specific loading state instead of global `isLoading`.

**Note:** PR #486 applies additional fixes after code review of PR #485: admin/files page gets download action for active files and "Video Editor" label for uploadedById; dashboard video editor section gains per-section search + load-more pagination; file-list hard delete available without `onHardDelete` prop.

### 3.1 New `/admin/files` page

**File:** `apps/huckleberry-drive/src/app/admin/files/page.tsx` (new)

**Purpose:** Admin-only file management with full visibility and control.

**Components:**
- **Filter bar** — instructor dropdown (from `getAllInstructors`), status select (active / deleted / all), search by filename
- **File table** with columns:
  - Filename
  - Instructor name (joined from users table)
  - Uploaded by ("Video Editor" label when `uploadedById` is set)
  - Size (formatted: MB/GB)
  - Status badge (On B2 / Deleted / Failed)
  - Deletion warning badge (shows days remaining before permanent deletion — only for deleted files within 60-day grace period)
  - Date uploaded
  - Actions
- **Actions per row:**
  - Download (all roles)
  - Soft Delete → Restore toggle (instructor restores own, admin restores any)
  - Hard Delete icon (admin only, shown with confirmation)
  - Play (admin only) — inline video preview (see [§ Video preview](#video-preview))
- **Bulk select + hard delete** (admin only)
- **Bulk download as ZIP** (admin + instructor) — see [§ Bulk download](#bulk-download)
- **Load more pagination** (cursor-based, 50 per page)

**API calls:**
- `GET /api/files?instructorId=&status=&search=&cursor=` — fetch paginated files
- `GET /api/admin/instructors` — fetch instructor list for dropdown filter
- `POST /api/files/[id]/restore` — restore soft-deleted file
- `DELETE /api/files/[id]/hard` — admin hard delete
- `POST /api/files/bulk-download` — start bulk ZIP job
- `GET /api/files/bulk-download/[jobId]` — poll ZIP job status

### 3.2 Update `/admin/page.tsx`

**File:** `apps/huckleberry-drive/src/app/admin/page.tsx`

Replace hardcoded `"-"` stats with live data from `/api/admin/stats`:
- Total Instructors count
- Total Files count
- Total Storage Used (formatted in GB/TB)
- Monthly Cost (estimated at $0.006/GB/mo from `totalBytes`)
- Recent admin audit log entries (PR #668)

### 3.3 Update `/dashboard/page.tsx`

**File:** `apps/huckleberry-drive/src/app/dashboard/page.tsx`

**Instructor view:**
- Add search input (filter files by filename, calls API with `?search=`)
- Add load-more pagination (pass `cursor` param, show "Load more" button)
- Refresh file list on upload completion (PR #665: navigate with `?uploaded=1` flag)
- Auto-refresh on focus + every 60s for role changes (PR #665: Clerk `user.reload()`)

**Video editor view:**
- Show two sections:
  1. "Files I uploaded" — calls `getVideoEditorUploads` via `/api/files?uploadedById=X`
  2. "Instructor's uploads" — calls `getUploadsForInstructors` via `/api/files?instructorId=Y`
- Both sections have their own search and pagination

### 3.4 Update `/uploads/page.tsx`

**File:** `apps/huckleberry-drive/src/app/uploads/uploads-client.tsx`

Video editors already pass `instructorId` to `UploadZone` — no changes needed here. (PR #665 wired `onUploadComplete` to navigate to dashboard with `?uploaded=1` flag.)

### 3.5 Update `file-list.tsx` component

**File:** `apps/huckleberry-drive/src/components/file-list.tsx`

Add to each row:
- **Restore button** — shown when `status === "deleted"`. Visible to file owner (instructor) and admin.
- **Hard delete icon** — shown when `status === "deleted"` and user is admin. Red trash icon with confirmation dialog.
- **Deletion warning badge** — for `status === "deleted"` files, show remaining grace period: `"Will be deleted in X days"` in amber/yellow. Uses `deletedAt` timestamp + 60-day window.
- **Play button** — shown for video files; opens inline video preview modal (see [§ Video preview](#video-preview))

### 3.6 Update `sidebar.tsx`

**File:** `apps/huckleberry-drive/src/components/sidebar.tsx`

Add "Files" link in admin section:
- Route: `/admin/files`
- Icon: `FolderOpen` or `Files` from lucide
- Only shown for `role === "admin"`

---

## Post-MVP additions (2026)

### Video preview

The original plan flagged "no video player component, need to build inline player with B2 signed URL." This is **now implemented in three places** using native HTML5 `<video>` (no third-party player library):

| Surface | File:Line | Pattern |
|---------|-----------|---------|
| Shared link page | `apps/huckleberry-drive/src/app/shared/[token]/page.tsx:207` | Inline `<video src={streamUrl} controls preload="metadata" className="w-full" />`; non-video files show a "Preview not available" message |
| Admin files page | `apps/huckleberry-drive/src/app/admin/files/page.tsx:633` | Modal launched by per-row Play button; `<video src={playingVideoUrl} controls autoPlay>` + close button |
| File list | `apps/huckleberry-drive/src/components/file-list.tsx:537` | Same modal pattern as admin/files |

**Auth model:** the shared link page uses B2 signed URLs gated by share-token auth (no Clerk session required). The admin/files and file-list modals use B2 signed URLs generated from the user's Clerk session. The existing `getSignedUrl` helper at `packages/storage/src/downloads.ts` is used for both.

**Known gap (optional follow-up):** The implementation uses native HTML5 video, which does **not** support HLS adaptive streaming for `.m3u8` files. For very large videos served from B2, this means the browser downloads the whole file before playback starts. Out of scope for the current PR cycle; if needed in the future, add `hls.js` (npm) and detect `contentType === "application/vnd.apple.mpegurl"` to switch to HLS playback.

### Bulk download

The original plan said "partial code in `@mentorships/storage/src/zip.ts` (`createAndUploadZip`), need trigger task + API endpoint + frontend." **All three pieces shipped in PR #667.**

**Backend (PR #667):**
- `POST /api/files/bulk-download` (`apps/huckleberry-drive/src/app/api/files/bulk-download/route.ts`)
  - Auth: instructor+ (`requireInstructor`)
  - Body: `{ fileIds: string[] }` (max 20 per request, enforced at route)
  - Validates `canAccessFile` for each file
  - Triggers the ZIP-build Trigger.dev task with the list of B2 keys
  - Persists job status (`bulk-download-jobs/<jobId>.json` in B2; `status: "pending"`)
  - Returns `{ jobId }`
- `GET /api/files/bulk-download/[jobId]` (poll endpoint)
  - Loads job status from B2
  - Auth: job owner OR admin
  - Returns `{ status, downloadUrl?, error?, expiresAt? }`; downloadUrl is a 1-hour signed URL once `status === "completed"`

**Frontend (PR #667):**
- `/admin/files`: per-row checkboxes + bulk-select-all; "Download selected" button starts a job and shows polling UI with a download link when ready.
- `/dashboard`: same pattern for instructor view.

**Limits:** `MAX_FILES_PER_REQUEST = 20`. Larger jobs should be chunked client-side. The Trigger.dev task itself is unbounded — files are streamed from B2 and zipped in-memory via `archiver`.

### Storage limit enforcement (OCC)

The original plan flagged a race condition: concurrent uploads could both pass the route-side `usedBytes + size > STORAGE_LIMIT_BYTES` pre-check before either committed. **Fixed in PR #665** by moving the authoritative check into the Convex `createUpload` mutation:

```ts
// apps/huckleberry-drive/src/app/api/uploads/initiate/route.ts:79-87
// PR1: per-instructor storage accounting is enforced inside the
// `createUpload` mutation so OCC catches concurrent uploads that
// race past a route-side pre-check. Keep a soft pre-check here
// for nicer error messages, but treat the mutation as the
// authoritative gate.
if (stats.usedBytes + size > STORAGE_LIMIT_BYTES) {
  return NextResponse.json(
    { error: "Storage limit exceeded", ... },
    { status: 413 }
  );
}
```

The Convex `instructorUploads.createUpload` mutation does a re-read of `getInstructorStorageStats` inside the same transaction; Convex OCC rejects any concurrent transaction that would push the count over the 50GB limit. The route-side check is kept purely for fast-fail UX (cleaner error messages without a roundtrip).

### Audit log for admin mutations

PR #668 added an audit log for admin mutations in the admin dashboard. Convex `writeAuditLog` helper is called atomically from the relevant admin mutations; the `/admin/page.tsx` dashboard shows the recent entries. This is a **platform-wide pattern**, not just HD-specific — see the audit log work in `convex/auditLog.ts` (referenced from `convex/http.ts:30` and the admin-onboarding flow).

---

## Permissions Summary (Final)

| Role | Upload | View Own | View All | Download | Soft Delete | Restore Own | Restore Any | Hard Delete | Filter |
|------|--------|----------|----------|----------|-------------|-------------|-------------|-------------|--------|
| **Instructor** | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Video Editor** | ✅ Assigned only | ✅ Uploaded by self | ❌ | ✅ Uploaded by self | ✅ Uploaded by self | ❌ | ❌ | ❌ | ❌ |
| **Admin** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Instructor, uploader, status |

**Post-MVP additions:**

| Role | Bulk Download | Play / Preview | Share Files | Receive Share |
|------|---------------|----------------|-------------|---------------|
| **Instructor** | ✅ | ✅ | ❌ (out of scope; instructor owns files) | ✅ |
| **Video Editor** | ❌ (only their own uploads) | ✅ | ✅ (PR #658) | ✅ |
| **Admin** | ✅ | ✅ | ✅ (PR #664 button + preview) | ✅ |

---

## Deletion Grace Period Logic

- Soft-deleted files (`status === "deleted"`) remain in DB with `deletedAt` timestamp
- Restore is allowed if `Date.now() - deletedAt < 60 days`
- After 60 days, restore returns `{ error: "grace_period_expired" }` — file remains deleted
- Admin hard delete (`DELETE /api/files/[id]/hard`) bypasses grace period — immediate B2 + DB removal
- Grace period warning shown in admin UI: `"Deletes in X days"` for files deleted within last 50-60 days

---

## API Endpoint Summary

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/files` | instructor+ | List files (admin bypasses, supports all filters) |
| GET | `/api/storage-usage` | instructor+ | Storage used (admin returns aggregate across all) |
| POST | `/api/files/[id]/restore` | instructor+ | Restore soft-deleted file |
| DELETE | `/api/files/[id]/hard` | admin | Hard delete (B2 + DB) |
| GET | `/api/admin/stats` | admin | Quick stats for admin dashboard |
| GET | `/api/admin/instructors` | admin | List instructors for filter dropdown |
| POST | `/api/uploads/initiate` | instructor+ | Initiate multipart upload (✅ done Phase 1; storage-limit OCC enforced in Convex mutation) |
| POST | `/api/uploads/complete` | instructor+ | Complete multipart upload |
| POST | `/api/uploads/abort` | instructor+ | Abort in-progress multipart upload |
| POST | `/api/files/bulk-download` | instructor+ | Start bulk ZIP job (max 20 files) |
| GET | `/api/files/bulk-download/[jobId]` | instructor+ (owner) or admin | Poll bulk ZIP job status |

---

## Files to Modify

### Phase 2 (API Routes) — ✅ All done
- `apps/huckleberry-drive/src/app/api/files/route.ts` — ✅ update GET, add admin filters
- `apps/huckleberry-drive/src/app/api/files/[id]/route.ts` — ✅ add restore POST
- `apps/huckleberry-drive/src/app/api/files/[id]/hard/route.ts` — ✅ **new** — hard delete DELETE
- `apps/huckleberry-drive/src/app/api/storage-usage/route.ts` — ✅ admin aggregate mode
- `apps/huckleberry-drive/src/app/api/admin/stats/route.ts` — ✅ **new**

### Phase 3 (Frontend) — ✅ All done (PR #486)
- `apps/huckleberry-drive/src/app/admin/page.tsx` — ✅ wire real stats with loading/error states; audit log (PR #668)
- `apps/huckleberry-drive/src/app/admin/files/page.tsx` — ✅ **new** — admin file management with filters, bulk hard delete, bulk download (PR #667), pagination, download action, "Video Editor" label, inline video preview (PR #665)
- `apps/huckleberry-drive/src/app/dashboard/page.tsx` — ✅ search with debounce, load more pagination, video editor dual-section view with per-section loading states, auto-refresh on focus (PR #665), bulk download
- `apps/huckleberry-drive/src/components/file-list.tsx` — ✅ restore button, hard delete with confirmation (no `onHardDelete` prop required), grace period badge, inline video preview modal
- `apps/huckleberry-drive/src/components/sidebar.tsx` — ✅ add admin files link (FolderOpen icon)
- `apps/huckleberry-drive/src/app/uploads/uploads-client.tsx` — ✅ gate uploads for video editors until instructor selected; wire `onUploadComplete` (PR #665)

### Post-MVP (June–July 2026) — ✅ All done
- `apps/huckleberry-drive/src/app/shared/[token]/page.tsx` — ✅ inline video preview (shared links)
- `apps/huckleberry-drive/src/app/api/files/bulk-download/route.ts` — ✅ **new** — start ZIP job (PR #667)
- `apps/huckleberry-drive/src/app/api/files/bulk-download/[jobId]/route.ts` — ✅ **new** — poll ZIP job (PR #667)
- `convex/instructorUploads.ts:createUpload` — ✅ authoritative 50GB storage limit with OCC (PR #665)
- `apps/huckleberry-drive/convex/hdShareLinks.ts` — ✅ share uploaded files with other video editors (PR #658, #664, #665)
- `convex/auditLog.ts` — ✅ admin mutation audit log (PR #668)

---

## Deferred (Post-MVP) — all closed as of 2026-07-24

| # | Item | Closed by | Notes |
|---|------|-----------|-------|
| 1 | ~~S3 archival automation~~ | n/a (removed by design) | B2-only storage decision; cheaper than expected |
| 2 | File preview / video playback | **3 inline implementations** (shared link, admin files, file list) | Native `<video>`; HLS adaptive streaming optional future work |
| 3 | Bulk download as ZIP | **PR #667** (`feat(hd): bulk download UI`) | Full pipeline: Trigger.dev task + POST/GET API + frontend polling |
| 4 | Storage limit per-instructor enforcement at API level | **PR #665** (`fix(hd): bug fixes, indexed reads, storage limit OCC`) | Authoritative check moved into Convex `createUpload` mutation; OCC handles concurrent races |

### Optional future work (no PR scoped)

- **HLS adaptive streaming** for large videos: add `hls.js` and detect `contentType === "application/vnd.apple.mpegurl"` to switch from progressive download to HLS. Not on any active roadmap.
- **Bulk download ZIP size cap**: currently `MAX_FILES_PER_REQUEST = 20` enforced at the route. For larger jobs, client-side chunking is required; no server-side chunking PR scoped.
- **Per-video-editor storage quota**: today all editors' uploads count against the assigned instructor's 50GB limit. If per-editor quotas become a requirement, add an `editorId` dimension to the storage stats query.

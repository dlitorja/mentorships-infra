# Huckleberry Drive MVP - Implementation Plan

## Status

| Phase | Status |
|-------|--------|
| Phase 1: Backend Schema & Convex Queries | ✅ Merged (PR #482, #479) |
| Phase 2: API Routes | ✅ Merged (PR #484) |
| Phase 3: Frontend Pages | ✅ Merged (PR #486 — fixes security, a11y, UX issues) |

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

**Note:** PR #486 delivers admin/files page with download action for active files and "Video Editor" label for `uploadedById`; dashboard video editor section gains per-section search + load-more pagination; `FileList` hard delete works without `onHardDelete` prop. Post-merge fixes (PR #487) addressed: `window.open` secured with `noopener,noreferrer` (admin/files + file-list); icon buttons given `aria-label` attributes (admin/files + file-list); video editor section uses section-specific loading state; concurrent download tracking changed from string to `Set`; filter changes reset bulk-selection state; `handleHardDelete` properly sets `isHardDeleting` at start; `fetchData` useCallback includes `userRole` in deps; `fetchVideoEditorUploads` catch block sets error state; all useEffect hooks have correct deps.

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
  - Status badge (On B2 / Archived / Deleted / Failed)
  - Deletion warning badge (shows days remaining before permanent deletion — only for deleted files within 60-day grace period)
  - Date uploaded
  - Actions
- **Actions per row:**
  - Download (all roles)
  - Soft Delete → Restore toggle (instructor restores own, admin restores any)
  - Hard Delete icon (admin only, shown with confirmation)
- **Bulk select + hard delete** (admin only)
- **Load more pagination** (cursor-based, 50 per page)

**API calls:**
- `GET /api/files?instructorId=&status=&search=&cursor=` — fetch paginated files
- `GET /api/admin/instructors` — fetch instructor list for dropdown filter
- `POST /api/files/[id]/restore` — restore soft-deleted file
- `DELETE /api/files/[id]/hard` — admin hard delete

### 3.2 Update `/admin/page.tsx`

**File:** `apps/huckleberry-drive/src/app/admin/page.tsx`

Replace hardcoded `"-"` stats with live data from `/api/admin/stats`:
- Total Instructors count
- Total Files count
- Total Storage Used (formatted in GB/TB)
- Monthly Cost (estimated at $0.006/GB/mo from `totalBytes`)

### 3.3 Update `/dashboard/page.tsx`

**File:** `apps/huckleberry-drive/src/app/dashboard/page.tsx`

**Instructor view:**
- Add search input (filter files by filename, calls API with `?search=`)
- Add load-more pagination (pass `cursor` param, show "Load more" button)
- Refresh file list on upload completion

**Video editor view:**
- Show two sections:
  1. "Files I uploaded" — calls `getVideoEditorUploads` via `/api/files?uploadedById=X`
  2. "Instructor's uploads" — calls `getUploadsForInstructors` via `/api/files?instructorId=Y`
- Both sections have their own search and pagination

### 3.4 Update `/uploads/page.tsx`

**File:** `apps/huckleberry-drive/src/app/uploads/uploads-client.tsx`

Video editors already pass `instructorId` to `UploadZone` — no changes needed here.

### 3.5 Update `file-list.tsx` component

**File:** `apps/huckleberry-drive/src/components/file-list.tsx`

Add to each row:
- **Restore button** — shown when `status === "deleted"`. Visible to file owner (instructor) and admin.
- **Hard delete icon** — shown when `status === "deleted"` and user is admin. Red trash icon with confirmation dialog.
- **Deletion warning badge** — for `status === "deleted"` files, show remaining grace period: `"Will be deleted in X days"` in amber/yellow. Uses `deletedAt` timestamp + 60-day window.

### 3.6 Update `sidebar.tsx`

**File:** `apps/huckleberry-drive/src/components/sidebar.tsx`

Add "Files" link in admin section:
- Route: `/admin/files`
- Icon: `FolderOpen` or `Files` from lucide
- Only shown for `role === "admin"`

---

## Permissions Summary (Final)

| Role | Upload | View Own | View All | Download | Soft Delete | Restore Own | Restore Any | Hard Delete | Filter |
|------|--------|----------|----------|----------|-------------|-------------|-------------|-------------|--------|
| **Instructor** | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Video Editor** | ✅ Assigned only | ✅ Uploaded by self | ❌ | ✅ Uploaded by self | ✅ Uploaded by self | ❌ | ❌ | ❌ | ❌ |
| **Admin** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Instructor, uploader, status |

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
| POST | `/api/uploads/initiate` | instructor+ | Initiate multipart upload (✅ done Phase 1) |

---

## Files to Modify

### Phase 2 (API Routes) — ✅ All done
- `apps/huckleberry-drive/src/app/api/files/route.ts` — ✅ update GET, add admin filters
- `apps/huckleberry-drive/src/app/api/files/[id]/route.ts` — ✅ add restore POST
- `apps/huckleberry-drive/src/app/api/files/[id]/hard/route.ts` — ✅ **new** — hard delete DELETE
- `apps/huckleberry-drive/src/app/api/storage-usage/route.ts` — ✅ admin aggregate mode
- `apps/huckleberry-drive/src/app/api/admin/stats/route.ts` — ✅ **new**

### Phase 3 (Frontend) — ✅ All done (PR #486)
- `apps/huckleberry-drive/src/app/admin/page.tsx` — ✅ wire real stats with loading/error states
- `apps/huckleberry-drive/src/app/admin/files/page.tsx` — ✅ **new** — admin file management with filters, bulk hard delete, pagination, download action, "Video Editor" label
- `apps/huckleberry-drive/src/app/dashboard/page.tsx` — ✅ search with debounce, load more pagination, video editor dual-section view with per-section loading states
- `apps/huckleberry-drive/src/components/file-list.tsx` — ✅ restore button, hard delete with confirmation (no `onHardDelete` prop required), grace period badge
- `apps/huckleberry-drive/src/components/sidebar.tsx` — ✅ add admin files link (FolderOpen icon)
- `apps/huckleberry-drive/src/app/uploads/uploads-client.tsx` — ✅ gate uploads for video editors until instructor selected

---

## Deferred (Post-MVP)

- S3 archival automation — **NOT deferred**: trigger already wired in `trigger/scheduled-tasks.ts` (`archiveOldFiles` daily cron). Code exists in `@mentorships/storage/src/archive.ts`.
- File preview / video playback — no video player component, need to build inline player with B2 signed URL
- Bulk download as ZIP — partial code in `@mentorships/storage/src/zip.ts` (`createAndUploadZip`), need trigger task + API endpoint + frontend
- Storage limit per-instructor enforcement at API level — currently only client-side display; need to add check to `POST /api/uploads/initiate` to prevent overages (race condition risk with concurrent uploads)
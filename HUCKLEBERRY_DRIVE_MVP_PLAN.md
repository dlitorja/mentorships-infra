# Huckleberry Drive MVP - Implementation Plan

## Status

| Phase | Status |
|-------|--------|
| Phase 1: Backend Schema & Convex Queries | ✅ Merged |
| Phase 2: API Routes | ⬜ Pending |
| Phase 3: Frontend Pages | ⬜ Pending |

---

## Phase 2: API Routes (Next.js)

### 2.1 Update `GET /api/files`

**File:** `apps/huckleberry-drive/src/app/api/files/route.ts`

Wire up `getAllUploads` Convex query to support admin's full file browsing with filters.

**Query params:**
- `?instructorId=X` — filter by instructor
- `?uploadedById=Y` — filter by uploader (video editor)
- `?status=deleted|completed|all` — filter by status
- `?search=filename` — filter by filename
- `?cursor=N&limit=50` — pagination

**Access control:**
- Instructors: see only their own uploads
- Video editors: see uploads they made (`uploadedById === userId`) AND instructor's own uploads (via `getUploadsForInstructors`)
- Admins: see all uploads with any filters

### 2.2 Update `GET /api/storage-usage`

**File:** `apps/huckleberry-drive/src/app/api/storage-usage/route.ts`

- Update `STORAGE_LIMIT_BYTES` from `20GB` → `50GB` ✅ (done in Phase 1)
- Admin mode: aggregate storage across ALL instructors (use `getTotalStorageStats`)
- Return `{ usedBytes, limitBytes: null, fileCount, instructorCount }` for admin

### 2.3 New `POST /api/files/[id]/restore`

**File:** `apps/huckleberry-drive/src/app/api/files/[id]/route.ts` (add restore method)

- Calls Convex `restoreUpload` mutation
- Instructor can restore their own soft-deleted files
- Admin can restore any file
- Returns `{ success: true }` or `{ error: "grace_period_expired" }`

### 2.4 New `DELETE /api/files/[id]/hard`

**File:** `apps/huckleberry-drive/src/app/api/files/[id]/route.ts` (add hard delete method)

- Admin only (gate with `requireAdmin()`)
- Calls Convex `hardDeleteUpload` mutation
- Deletes from B2 + removes DB record

### 2.5 New `GET /api/admin/stats`

**File:** `apps/huckleberry-drive/src/app/api/admin/stats/route.ts` (new file)

- Requires admin auth (`requireAdmin()`)
- Calls Convex `getAdminStats` query
- Returns `{ totalInstructors, totalFiles, totalBytes, activeFiles, activeBytes }`

---

## Phase 3: Frontend Pages

### 3.1 New `/admin/files` page

**File:** `apps/huckleberry-drive/src/app/admin/files/page.tsx` (new)

**Purpose:** Admin-only file management with full visibility and control.

**Components:**
- **Filter bar** — instructor dropdown (from `getAllInstructors`), status select (active / deleted / all), search by filename
- **File table** with columns:
  - Filename
  - Instructor name (joined from users table)
  - Uploaded by (video editor name, if `uploadedById` is set)
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
- `GET /api/admin/stats` — fetch instructor list for dropdown
- `POST /api/files/[id]/restore` — restore soft-deleted file
- `DELETE /api/files/[id]/hard` — admin hard delete

### 3.2 Update `/admin/page.tsx`

**File:** `apps/huckleberry-drive/src/app/admin/page.tsx`

Replace hardcoded `"-"` stats with live data from `/api/admin/stats`:
- Total Instructors count
- Total Files count
- Total Storage Used (formatted in GB/TB)
- Monthly Cost (placeholder — use `getTotalStorageStats` for now)

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
| POST | `/api/uploads/initiate` | instructor+ | Initiate multipart upload (✅ done Phase 1) |

---

## Files to Modify

### Phase 2 (API Routes)
- `apps/huckleberry-drive/src/app/api/files/route.ts` — update GET, add admin filters
- `apps/huckleberry-drive/src/app/api/files/[id]/route.ts` — add restore POST, hard delete DELETE
- `apps/huckleberry-drive/src/app/api/storage-usage/route.ts` — admin aggregate mode
- `apps/huckleberry-drive/src/app/api/admin/stats/route.ts` — **new**

### Phase 3 (Frontend)
- `apps/huckleberry-drive/src/app/admin/page.tsx` — wire real stats
- `apps/huckleberry-drive/src/app/admin/files/page.tsx` — **new** — admin file management
- `apps/huckleberry-drive/src/app/dashboard/page.tsx` — search + pagination + video editor sections
- `apps/huckleberry-drive/src/components/file-list.tsx` — restore button, hard delete, grace period badge
- `apps/huckleberry-drive/src/components/sidebar.tsx` — add admin files link

---

## Deferred (Post-MVP)

- S3 archival automation (code exists in `@mentorships/storage`, no trigger wired)
- File preview / video playback
- Bulk download as ZIP
- Storage limit per-instructor enforcement at API level (currently only client-side enforcement)
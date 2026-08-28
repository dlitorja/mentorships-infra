# Huckleberry Drive — Bulk-Download Chunking + Per-Editor Quotas

> **Status: implemented** (2026-07-25). See the git diff for the code changes. The notes below describe the design and the files that changed.

## TL;DR

- **Bulk-download chunking:** the 20-file cap is a stop-gap, not a hard scalability limit. The real constraints are Trigger.dev task duration (600s) and the current task buffering the entire ZIP into memory before uploading to B2. The recommended fix is a **parent/child Trigger task** that splits large selections into byte-bounded chunks, and a **streaming/multipart chunk task** that never holds the whole ZIP in RAM.
- **Per-video-editor quotas:** the schema already tracks the uploader (`uploadedById`) and the editor-to-instructor assignment (`videoEditorAssignments`). The recommended fix is adding a **per-assignment `storageQuotaBytes`** to `videoEditorAssignments`, enforcing it in both the upload route and the `createUpload` Convex mutation, and building a small admin page to manage it.

Both are **medium-complexity feature work** (not hotfixes). I recommend doing them as two separate PRs.

---

## 1. Current state

### Bulk download

- `apps/huckleberry-drive/src/app/api/files/bulk-download/route.ts` enforces `MAX_FILES_PER_REQUEST = 20`.
- `src/trigger/bulk-download.ts` is the worker. It:
  1. downloads every B2 object to a local temp file,
  2. creates a ZIP on disk,
  3. reads the entire ZIP back into memory as a `Buffer`,
  4. uploads the buffer to B2 with `PutObjectCommand`.
- `maxDuration: 600` (10 minutes).
- The 20-file limit is copied to `apps/huckleberry-drive/src/lib/api.ts` (`BULK_DOWNLOAD_MAX_FILES = 20`) and the UI (`use-bulk-download`, `bulk-download-bar`).
- The result is a single signed URL valid for 24 hours.

### Storage quotas

- `videoEditorAssignments` has `videoEditorId`, `instructorId`, `assignedAt`, `assignedBy`, and an optional `storageQuotaBytes`.
- `instructorUploads` has `uploadedById` for editor uploads.
- `convex/instructorUploads.ts:createUpload` enforces the per-assignment `storageQuotaBytes` for video editors; instructors and admins have no storage cap.
- `apps/huckleberry-drive/src/app/api/uploads/initiate/route.ts` does a route-side pre-check for video-editor quotas only.
- The dashboard’s storage-usage component shows a limit only for video editors with an explicit quota; instructors see unlimited storage.

---

## 2. Recommended approach: bulk-download server-side chunking

### Goal

Let users select **more than 20 files** without blowing the 10-minute task limit or running out of memory. Return one or more ZIP URLs depending on the size of the selection.

### High-level design

1. **Keep the POST API simple:** the route still accepts `fileIds[]` and returns `{ jobId }`. The chunking is invisible to the caller.
2. **Parent/child Trigger jobs:**
   - `process-bulk-download` (parent) splits the file list into chunks, launches child tasks, waits for them, and writes the final combined job status.
   - `process-bulk-download-chunk` (child) produces a single ZIP for its chunk.
3. **Chunk by count AND bytes:**
   - `MAX_FILES_PER_CHUNK = 20` (keeps the current proven cap).
   - `MAX_BYTES_PER_CHUNK = 5 * 1024 * 1024 * 1024` (5 GB). A chunk can be 20 files *or* 5 GB, whichever is hit first.
4. **Stream the chunk ZIP to B2 using multipart upload** instead of buffering to disk/memory.
5. **UI shows multiple ZIP parts** when a job is split. When only one chunk is produced, behavior is exactly the same as today.

### Why not just raise the limit?

- A 50-file video batch could easily be 100 GB. The existing task would run for far more than 600 seconds and/or exhaust the worker’s memory.
- One slow B2 download or one large file can fail the entire ZIP. With chunks, only the failed chunk retries.
- The current ZIP is built from temp files, then re-read into a buffer, then uploaded. That triples the I/O.

### Proposed task architecture

```
POST /api/files/bulk-download
   └── creates parent job record in B2
   └── triggers process-bulk-download

process-bulk-download (parent)
   ├── splits files into chunks
   ├── saves chunk metadata
   ├── batchTriggerAndWait(process-bulk-download-chunk, chunks)
   ├── aggregates results
   └── updates parent job record

process-bulk-download-chunk
   ├── streams files from B2 into archiver
   ├── pipes archiver output to S3 multipart upload
   └── returns signed URL + file count + total bytes
```

### B2 job state layout

```
bulk-download-jobs/<parentJobId>.json          # parent status + downloadUrls
bulk-download-jobs/<parentJobId>/chunks/0.json  # child status
bulk-download-jobs/<parentJobId>/chunks/1.json
```

### Child task: streaming chunk implementation

Use `@aws-sdk/lib-storage` `Upload` to stream the archiver output directly to B2:

```ts
import { Upload } from "@aws-sdk/lib-storage";

const archive = archiver("zip", { store: true }); // videos are already compressed

const upload = new Upload({
  client: getB2Client(),
  params: {
    Bucket: B2_BUCKET_NAME,
    Key: `bulk-downloads/${date}/${parentJobId}/chunk-${chunkIndex}.zip`,
    Body: archive,
    ContentType: "application/zip",
    ContentDisposition: `attachment; filename="bulk-download-${chunkIndex}.zip"`,
  },
  partSize: 5 * 1024 * 1024,
  leavePartsOnError: false,
});

// append each file as a B2 stream
for (const file of files) {
  const object = await client.send(new GetObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: file.b2Key,
  }));
  if (object.Body) {
    archive.append(object.Body as Readable, { name: file.originalName });
  }
}

archive.finalize();
await upload.done();
```

Notes:

- `store: true` avoids wasting CPU compressing video files.
- If a single chunk must fall back to temp files, the fallback should be isolated to the child task.
- The child task should catch download errors, mark its chunk as `failed`, and return an error so the parent can mark the whole job failed.

### Parent task: orchestration

- Trigger.dev SDK supports `tasks.batchTriggerAndWait(...)` in the current version (`@trigger.dev/sdk@4.4.6`).
- The parent task should wait for all chunks.
- If any chunk fails, the parent job status becomes `failed` with per-chunk error details.
- If all succeed, the parent writes `downloadUrls[]`, `fileCount`, `totalBytes`, and `expiresAt`.

### Route / poll changes

- `apps/huckleberry-drive/src/app/api/files/bulk-download/route.ts`:
  - Remove the 20-file hard cap.
  - Validate all requested files (or defer validation to the parent task; prefer route-side for fast UX).
  - Create the parent job record.
  - Trigger `process-bulk-download`.
  - Return `{ jobId }`.
- `apps/huckleberry-drive/src/app/api/files/bulk-download/[jobId]/route.ts`:
  - Read the parent job.
  - Return `downloadUrls` array. Keep `downloadUrl` for the single-chunk case so existing UI keeps working.

### Frontend changes

- `apps/huckleberry-drive/src/lib/api.ts`:
  - Add `downloadUrls?: string[]` and `totalBytes?: number` to `BulkDownloadStatus`.
  - Remove or relax `BULK_DOWNLOAD_MAX_FILES` from the client (server is authoritative).
- `apps/huckleberry-drive/src/hooks/use-bulk-download.ts`:
  - If `downloadUrls` has multiple entries, render them as a list of part buttons instead of auto-opening a single window.
  - Auto-open the single URL when only one chunk is returned.
- `apps/huckleberry-drive/src/components/bulk-download-progress.tsx`:
  - Show “ZIP part 1 of 3 ready” style messaging.
- `apps/huckleberry-drive/src/components/bulk-download-bar.tsx`:
  - Remove the hard “max 20” disabled state; instead show the total selected count and a soft warning for very large selections (e.g., > 500 files).

### Files to touch

- `src/trigger/bulk-download.ts` — refactor into parent orchestrator.
- `src/trigger/bulk-download-chunk.ts` — new streaming chunk task.
- `apps/huckleberry-drive/src/app/api/files/bulk-download/route.ts`.
- `apps/huckleberry-drive/src/app/api/files/bulk-download/[jobId]/route.ts`.
- `apps/huckleberry-drive/src/lib/api.ts`.
- `apps/huckleberry-drive/src/hooks/use-bulk-download.ts`.
- `apps/huckleberry-drive/src/components/bulk-download-progress.tsx`.
- `apps/huckleberry-drive/src/components/bulk-download-bar.tsx`.
- Root `package.json` — add `@aws-sdk/lib-storage`.

### Risks / open questions

- `batchTriggerAndWait` waiting time is still bounded by the parent task’s 600s limit. If a large batch has many slow chunks, the parent may time out before children finish. **Mitigation:** keep the byte cap low (5 GB initially) and/or use a fire-and-forget parent with child tasks writing parent status directly.
- B2 S3-compatible multipart upload must be tested in a dev bucket. If it fails, fall back to `PutObjectCommand` with a smaller byte cap.
- ZIP files in `bulk-downloads/` are never deleted after the signed URL expires. Add a B2 lifecycle rule or a cleanup Trigger job for that prefix.
- Multiple ZIP parts are slightly less convenient than one file. Acceptable trade-off for reliability.

### Estimated effort

- **3–4 days** including dev, local testing, and UI updates.

---

## 3. Recommended approach: per-video-editor storage quotas

### Goal

Allow admins to give a video editor a storage cap that is **independent of the instructor’s 50 GB limit**. If no quota is set, the current behavior is unchanged.

### High-level design

- Add `storageQuotaBytes: v.optional(v.number())` to `videoEditorAssignments`.
- Enforce the quota in both:
  - `apps/huckleberry-drive/src/app/api/uploads/initiate/route.ts` (fast UX pre-check)
  - `convex/instructorUploads.ts:createUpload` (authoritative, OCC-protected)
- Build a small admin page to view assignments and set quotas.

### Why per-assignment instead of global?

- The existing data model is already per-assignment (`videoEditorAssignments`).
- It gives admins the most granular control: editor A can have 10 GB for instructor X and 20 GB for instructor Y.
- A global quota can be added later on the `users` table if needed; per-assignment is the smallest additive change.

### Schema changes

```ts
videoEditorAssignments: defineTable({
  videoEditorId: v.string(),
  instructorId: v.string(),
  assignedAt: v.optional(v.number()),
  assignedBy: v.optional(v.string()),
  storageQuotaBytes: v.optional(v.number()), // NEW
}).index(...)
```

### Convex additions

- `getVideoEditorStorageStats({ videoEditorId, instructorId })` — sums active bytes of uploads where `uploadedById = videoEditorId` and `instructorId = instructorId`. Use the existing `by_uploadedById` index.
- `getVideoEditorAssignmentsWithStorage({ videoEditorId })` — returns each assignment with its used bytes.
- `setVideoEditorAssignmentQuota({ assignmentId, quotaBytes? })` — admin-only mutation.
- Update `createUpload` to:
  - Look up the assignment for delegated uploads.
  - If `storageQuotaBytes` is set, reject when `editorUsedBytes + size > quota`.
  - Still enforce the instructor-wide 50 GB limit.

### Route changes

- `apps/huckleberry-drive/src/app/api/uploads/initiate/route.ts`:
  - After the `isVideoEditorAssignedToInstructor` check, if an assignment has a non-null quota, call the stats query and reject if it would be exceeded.
  - Return a clear 403: `"Video editor storage quota exceeded for this instructor"`.

### Storage-usage display

- `apps/huckleberry-drive/src/app/api/storage-usage/route.ts`:
  - For `video_editor` role, return the per-assignment quota and the editor’s used bytes for the currently selected/relevant instructor.
  - If the editor has no quota, return `limitBytes: null` or the instructor’s 50 GB limit depending on desired UX.
- Update the `StorageUsage` component to show the editor’s quota label.

### Admin UI

- New page: `/admin/video-editors`.
  - List all `video_editor` users.
  - For each editor, show their instructor assignments and used storage.
  - Inline edit the quota for each assignment (e.g., GB input, empty = unlimited).
- Alternatively, extend `/admin/users` with a “Manage quotas” button for each video editor that opens the same modal.

### API additions

- `GET /api/admin/video-editors` — returns assignments + stats.
- `PATCH /api/admin/video-editors/assignments/:assignmentId` — sets quota.
- Add types and functions in `apps/huckleberry-drive/src/lib/api.ts`.

### Files to touch

- `convex/schema.ts` — add `storageQuotaBytes`.
- `convex/videoEditorAssignments.ts` — new queries/mutation.
- `convex/instructorUploads.ts` — enforce quota in `createUpload`.
- `apps/huckleberry-drive/src/app/api/uploads/initiate/route.ts`.
- `apps/huckleberry-drive/src/app/api/storage-usage/route.ts`.
- `apps/huckleberry-drive/src/app/api/admin/video-editors/route.ts` — new.
- `apps/huckleberry-drive/src/app/api/admin/video-editors/[assignmentId]/route.ts` — new.
- `apps/huckleberry-drive/src/app/admin/video-editors/page.tsx` — new.
- `apps/huckleberry-drive/src/lib/api.ts` — new types/functions.
- `apps/huckleberry-drive/src/components/storage-usage.tsx` — optional label.

### Risks

- **OCC conflicts:** `createUpload` will now read two indexes (`by_instructorId` and `by_uploadedById`) in the same transaction. Concurrency is still handled by Convex OCC, but the chance of a transient conflict on a busy editor is higher than today. The route-side pre-check keeps most users from ever hitting the mutation conflict.
- **Backfill:** all existing assignments get `storageQuotaBytes = undefined`, so behavior is unchanged. No migration needed.
- **UI confusion:** an editor assigned to multiple instructors needs a clear way to see which instructor they are viewing storage for. The upload page already has an instructor selector; the dashboard can use the same selection.

### Estimated effort

- **2–3 days** including the admin page and route/mutation changes.

---

## 4. Suggested PR split

| PR | Focus | Estimated effort |
|----|-------|------------------|
| 1 | Bulk-download chunking + streaming multipart | 3–4 days |
| 2 | Per-assignment video-editor storage quota | 2–3 days |

Keep them separate because they touch different subsystems (Trigger storage vs. upload auth/quota) and have different risk profiles.

---

## 5. Open decisions before coding

1. **Chunk product:** are multiple ZIP parts acceptable, or do you want a single merged ZIP? Merging ZIPs is non-trivial; I recommend multiple parts.
2. **Chunk byte cap:** start with 5 GB? The safer default is lower (e.g., 2 GB) and raise after testing.
3. **Editor quota scope:** confirm per-assignment is preferred over a global per-editor quota.
4. **B2 multipart support:** validate the `@aws-sdk/lib-storage` streaming upload against a dev bucket before relying on it.

---

## 6. Bottom line

- **Bulk-download chunking** is the more valuable of the two if users are hitting the 20-file cap today. The parent/child task design with streaming multipart is the right long-term fix.
- **Per-editor quotas** are only needed if the business wants to cap how much an individual editor can upload, rather than relying on the instructor’s 50 GB limit.
- Both are **additive, non-breaking** changes when default quotas are null and the UI gracefully handles multiple ZIP parts.

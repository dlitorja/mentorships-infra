# HANDOFF — PR 3c (workspace-storage cutover + narrow)

**Date:** 2026-09-28
**Branch:** `feat/workspace-storage-pr3c-cutover-and-narrow`
**Worktree:** `/tmp/ws-pr3c`
**Base:** `3e2133ba` (PR 3b merged)
**Target PR:** opens against `main` once all commits are in
**Tracking:** HUC-57 (`schema-change` + `prod` + `verification`)

## What is done (4 commits ahead of main)

| # | Commit | Summary |
|---|---|---|
| 1 | `3a45137f` | Schema soft-deprecate `storageId` on 4 tables + add `fileUploads.trashedAt`. Reverted `v.id("_storage")` → `v.string()` on 2 tables to preserve args validator symmetry. |
| 2 | `8d1599dd` | Restored `generateWorkspaceImageUploadUrl` action (apps/web legacy client still uses it). Gated by `WORKSPACE_STORAGE_USE_B2` flag. |
| 3 | `d8c0b8a6` | Converted 4 mutations (`embedImageInNote`, `createWorkspaceImage`, `createWorkspaceImageAndMessage`, `createWorkspaceFileMessage`) + 2 gallery queries (`getWorkspaceImages`, `getWorkspaceImagesPaginated`) + export query (`getWorkspaceExportData`) to B2 path. Removed `recordFileUpload` mutation, `assertFileUploadOwnedByCaller` helper, `migrateWorkspaceImage` action + internal mutation + `getImagesNeedingMigration` query. Added `assertB2FileUploadOwnedByCaller` helper. |
| 4 | `9d7cb0ce` | Added `WORKSPACE_STORAGE_USE_B2` cutover flag + `requireB2Enabled()` helper to `workspaceStorage.ts`. Gates all 3 B2 actions. |

**Typecheck state:** `apps/platform` has 3 remaining errors (UI swap not done). Everything else passes.

## What remains

### 1. UI swap — apps/platform (5 components + 1 hook)

Typecheck errors at:
- `apps/platform/components/workspace/chat/hooks/use-chat-attachments.ts:167` — passes `storageId` to `createWorkspaceImageAndMessage` (now wants `b2Key`)
- `apps/platform/components/workspace/chat/hooks/use-chat-attachments.ts:175` — passes `storageId` to `createWorkspaceFileMessage` (now wants `b2Key`)
- `apps/platform/components/workspace/notes/notes.tsx:111` — `UseEmbedImageInNote` type mismatch (now wants `b2Key`)

**Approach for the 5 components:**
- Replace `import { uploadImageForChat, uploadFileForChat } from '@/lib/workspace-image-upload'` with `import { uploadFileToB2 } from '@/lib/b2-workspace-upload'`
- Replace `useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl)` with `useConvexAction(api.workspaceStorage.generateWorkspaceUploadUrl)`
- Replace `useRecordFileUpload` mutation with `useRecordB2FileUpload` action
- Replace `embedImageInNote({ storageId })` with `embedImageInNote({ b2Key })`
- Replace `createWorkspaceImageAndMessage({ storageId })` with `createWorkspaceImageAndMessage({ b2Key })`
- Replace `createWorkspaceFileMessage({ storageId })` with `createWorkspaceFileMessage({ b2Key, fileName })`

**Approach for the 1 hook:**
- `apps/platform/lib/queries/convex/use-workspaces.ts:445 useCreateWorkspaceImage` — keep, but UI callers pass `b2Key` not `storageId`
- `apps/platform/lib/queries/convex/use-workspaces.ts:519 useRecordFileUpload` — DELETE; use `api.workspaceStorage.recordB2FileUpload` directly via `useConvexAction`

**File delete:**
- `apps/platform/lib/workspace-image-upload.ts` — delete (B2 helper supersedes)

### 2. UI resolver hook (NEW)

Need a `useWorkspaceImageUrl` hook in `apps/platform/lib/queries/convex/use-workspaces.ts` (or similar) that:
- Takes a `WorkspaceImage` row (with `b2Key`, `storageId`, `imageUrl` fields)
- If `b2Key !== undefined`, calls `getWorkspaceDownloadUrl({ b2Key, workspaceId })` to resolve
- Else if `storageId !== undefined`, returns the legacy URL (resolved server-side via `ctx.storage.getUrl` in the gallery query — no UI call needed)
- Else returns `imageUrl` directly

Same for chat messages: `useWorkspaceFileUrl(row)` that:
- If `type === "file"`, splits content on `|`, checks if right side is URL (`https://`) or `b2Key`, resolves accordingly
- If `type === "image"`, checks if content is URL or `b2Key`

### 3. Crons + cron actions

**New crons in `convex/crons.ts`:**
- `cleanupExpiredWorkspaceB2Uploads` — daily `0 3 * * *` UTC
- `cleanupOrphanB2Objects` — weekly `0 4 * * 0` UTC

**New action: `workspaceStorage.cleanupExpiredWorkspaceB2Uploads` (internal action)**
- Finds `fileUploads` rows where `cancelledAt !== undefined && trashedAt === undefined`
- Deletes the B2 object (via b2Delete)
- Sets `trashedAt: Date.now()`
- Limits candidates per tick + batches

**New action: `cleanup/workspaceB2OrphanSweep.ts` (internal action)**
- Lists B2 bucket objects, diffs against `fileUploads` ledger rows + workspaceImages/Messages/NoteComments `b2Key` references
- Deletes orphans (objects in B2 not referenced anywhere)

### 4. (removed) B2 lifecycle script

**`scripts/set-b2-bucket-lifecycle.ts`** — REMOVED in PR 3c round 4 (Greptile P1 "Lifecycle deletes referenced objects"). The Convex daily `cleanupExpiredWorkspaceB2Uploads` cron is the SOLE source of truth for retention. A bucket-wide lifecycle rule operates on objects, not references — a row whose `completedAt` is past the 18-month window could be deleted before the cron had a chance to read its live references. The trade-off: if the cron fails for several days, B2 storage cost grows; correctness is preserved (no dangling references).

### 5. Tests

- Update `convex/workspaceStorage.test.ts` — add `WORKSPACE_STORAGE_USE_B2` flag-set/unset test cases
- Update `convex/cleanup/chatFileRetention.test.ts` — unchanged (we kept the storageId-based path per the user's soft-deprecate decision)
- New tests:
  - `convex/workspaceStorage.test.ts` — `cleanupExpiredWorkspaceB2Uploads` action tests
  - `convex/cleanup/workspaceB2OrphanSweep.test.ts` — orphan detection tests
- Update `convex/workspaces.test.ts` — verify `embedImageInNote`, `createWorkspaceImageAndMessage`, `createWorkspaceFileMessage` reject `b2Key` not in ledger

### 6. Verification

- `NODE_OPTIONS="--max-old-space-size=8192" pnpm --filter @mentorships/platform typecheck` → green
- `pnpm typecheck` → green (web, marketing, packages/{db,payments,security})
- `pnpm test` → green (vitest, esp. workspaceStorage + chatFileRetention + new cron tests)
- `npx convex dev` → check types codegen clean
- Commit + push + open PR
- Greptile rounds until approved
- `gh pr merge --squash --delete-branch`
- Mark HUC-57 Done + update `docs/plans/pr-11-workspace-storage-b2.md`

## Key design decisions

### A) Soft-deprecate `storageId` (not drop)
- `storageId` column + `by_storageId` index retained on 4 tables (`workspaceImages`, `workspaceMessages`, `workspaceNoteComments`, `fileUploads`)
- Drop deferred to a follow-up PR after PR 2 backlog clears in production
- Validators stay `v.optional(v.string())` to preserve args validator symmetry with `convex/workspaces.ts`
- `cleanupMigratedConvexStorageBlobs` cron (PR 3a) keeps working
- `chatFileRetention.findLiveStorageReferences` keeps working

### B) apps/web NOT migrated to B2
- `apps/web/components/workspace/images.tsx` still calls `generateWorkspaceImageUploadUrl` → kept the action + gated behind flag
- `apps/web` uses `createWorkspaceImage({ storageId })` → kept `storageId: v.optional(v.string())` on the mutation
- apps/web is the legacy client; apps/platform is the new one

### C) Mutation args
- `embedImageInNote` / `createWorkspaceImageAndMessage` / `createWorkspaceFileMessage`: arg renamed `storageId` → `b2Key` (only apps/platform uses)
- `createWorkspaceImage`: accepts EITHER `storageId` (legacy apps/web) OR `b2Key` (new apps/platform)

### D) DB row shape
- B2 rows: `b2Key: <key>`, `imageUrl: ""` (placeholder), `storageId: undefined`
- Legacy rows: `storageId: <convex id>`, `b2Key: undefined`, `imageUrl: <resolved URL>`
- Gallery queries resolve legacy `imageUrl` server-side via `ctx.storage.getUrl`; B2 rows return `imageUrl: ""` and the UI resolver hook converts `b2Key` → URL

### E) Chat message content format
- File: `${encodeURIComponent(fileName)}|${b2Key}` (was `|${url}`)
- Image: `${b2Key}` (was `${url}`)
- UI resolver hook detects URL prefix (`https://`) vs b2Key

## Working environment

- Use `NODE_OPTIONS="--max-old-space-size=8192"` for `pnpm --filter @mentorships/platform typecheck` (8GB heap — default OOMs)
- Root `pnpm typecheck` only covers apps/web, apps/marketing, packages/{db,payments,security} (project references) — NOT apps/platform
- Linear CLI wrapper: `node scripts/linear-cli.mjs teams` etc. — auth cached at `~/.local/share/opencode/mcp-auth.json`
- Greptile CLI: `npx greptile@latest review -b main`

## Reference docs

- `docs/plans/pr-11-workspace-storage-b2.md` — the PR 11 source-of-truth plan
- `AGENTS.md` — Linear + schema-change + Greptile + secret-protection policies
- `convex/_generated/ai/guidelines.md` — Convex ^1.44.0 guidelines (must-read before any convex/ edits)
- `convex/cleanup/postMigrationStorageCleanup.ts` — template for new cleanup action
- `scripts/set-b2-bucket-cors.ts` — template for new bucket config script (lifecycle script was removed; see §4)
- `apps/platform/lib/b2-workspace-upload.ts` — B2 helper (already exists, contains `uploadFileToB2`, `resolveB2DownloadUrl`, `validateB2Files`, `createB2ImagePreviews`, `generateB2FileId`)

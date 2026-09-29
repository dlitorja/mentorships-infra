# HANDOFF — PR 3c (workspace-storage cutover + narrow) — **MERGED**

**Date:** 2026-09-28
**Branch:** `feat/workspace-storage-pr3c-cutover-and-narrow`
**Worktree:** `/tmp/ws-pr3c`
**Base:** `3e2133ba` (PR 3b merged)
**Target PR:** [#888](https://github.com/dlitorja/mentorships-infra/pull/888) — squash-merged to `main`
**Follow-up:** [#891](https://github.com/dlitorja/mentorships-infra/pull/891) (canonical CORS ruleset for workspace bucket) — squash-merged to `main` 2026-09-29
**Tracking:** HUC-57 (`schema-change` + `prod` + `verification`)

## Status: SHIPPED

PR 3c is merged. 9 commits ahead of base, all P1 Greptile findings
addressed (rounds 4–8). 60/60 unit tests pass on the
`workspaceStorage` test suite; CI is green (5/5 jobs: convex-codegen,
typecheck-convex, typecheck-apps, lint, e2e, build); 4 Vercel preview
deploys SUCCESS (huckleberry-drive, web, marketing, platform).

## Final commits (tip → base)

| # | Commit | Summary |
|---|---|---|
| 9 | `f8120213` | Round 8: Greptile round-5 P1 #14 (URL TTL clamp to retention deadline) + #15 (image-position re-scan by b2Key) |
| 8 | `440a37f7` | Round 7: regenerate `convex/_generated/api.d.ts` with the two new cleanup modules |
| 7 | `25e777b3` | Round 6: fix CI codegen TS errors — `ctx.runAction` takes `internal.<module>.<fn>`, not a direct import |
| 6 | `8a87e73d` | Round 5: Greptile round-4 P1 #12 (resolver short-circuits past-retention / deleted workspace) + #13 (note editor cursor jump) |
| 5 | `ab1d2e2f` | Round 4: Greptile round-3 P1 #3–#8, #10, #11 |
| 4 | `2a866cfd` | Round 3: gate tests (`WORKSPACE_STORAGE_USE_B2` set/unset) |
| 3 | `f3d5827f` | Round 2: retention + orphan + lifecycle cron modules |
| 2 | `43e96370` | Round 1: UI swap (apps/platform chat + notes + image upload) |
| 1 | `041dbf7e` | Handoff doc + plan doc updates |

Base: `3e2133ba` (PR 3b merged).

## All Greptile P1 findings, with their fix commit

| # | Round | Finding | Fix |
|---|---|---|---|
| 1 | 3 | Web image uploads stop (`convex/workspaceActions.ts`) | **DEFERRED** — apps/web migration is a separate initiative (gated behind `WORKSPACE_STORAGE_USE_B2` inverse) |
| 2 | 3 | Web gallery loses B2 images (`convex/workspaces.ts`) | **DEFERRED** — same as #1 |
| 3 | 4 | Gallery URLs never appear | `resolveWorkspaceB2FileUploadsForKeys` called from `getWorkspaceImages[Paginated]`; UI hooks rewritten as pass-throughs |
| 4 | 4 | Chat treats keys as URLs | `resolveChatMessageUrl` populates `imageUrl`/`fileUrl` in `getWorkspaceMessages[Paginated]` |
| 5 | 4 | Comment attachments disappear | New `attachmentUrl` field on `getNoteComments`; `NoteComments.tsx` consumer falls back to legacy `storageId` URL |
| 6 | 4 | Resource image previews disappear | Resolver wired into `getInstructorResources` + `getSharedResourcesForActiveSession` |
| 7 | 4 | Exports omit B2 images | Resolver wired into `getWorkspaceExportData` (both `workspaces.ts` and `queries/http.ts` copies) |
| 8 | 4 | Image limits can be bypassed | `contentType` persisted on `fileUploads` ledger; `createWorkspaceImage` + `embedImageInNote` reject non-image content types from the ledger |
| 9 | 3 | Ledgerless orphans evade sweep | **DEFERRED** — separate Linear issue HUC-52 (low priority) |
| 10 | 4 | Lifecycle deletes referenced objects | `scripts/set-b2-bucket-lifecycle.ts` DELETED; Convex daily cron is sole source of truth for retention |
| 11 | 4 | Saved note images expire | Custom Tiptap `Image` extension stores `b2Key`; `useNoteEditor` re-mints URLs on load via `resolveB2KeyImageSrcs` |
| 12 | 5 | Downloads bypass retention deadline | `resolveWorkspaceB2FileUploadsForKeys` short-circuits with `workspace_deleted` / `workspace_past_retention` errors |
| 13 | 5 | Image loading moves the cursor | Replaced `setNodeSelection`+`updateAttributes` with single `tr.setNodeMarkup` transaction + same-note guard |
| 14 | 8 | Download URLs outlive retention | Read resolver now clamps URL TTL via `clampWorkspaceDownloadExpiresInSeconds(..., remainingRetentionSeconds)`; active workspaces keep the full 1-hour default |
| 15 | 8 | Edits leave images unresolved | `resolveB2KeyImageSrcs` re-scans the doc by `b2Key` AFTER the await (not by pre-recorded position), so concurrent edits don't strand images |

## Round 6/7/8 plumbing fixes

- **Round 6 (`25e777b3`)**: `ctx.runAction(deleteFromB2WorkspaceAction, ...)` — the
  cron action body imported the function directly, but Convex's `ctx.runAction`
  expects `internal.workspaceStorage.deleteFromB2WorkspaceAction` (the
  generated reference with `_type` + `_componentPath` metadata). Same pattern
  as `chatFileRetention.ts:582`. Fix: drop the direct import; use
  `internal.workspaceStorage.<fn>`.
- **Round 7 (`440a37f7`)**: The CI `Fail if codegen produced unstaged changes`
  step now succeeds after the regenerated `_generated/api.d.ts` adds the two
  new cleanup modules. The diff is purely additive (4 lines).
- **Round 8 (`f8120213`)**: Addresses round-5 Greptile P1 #14 + #15.

## Post-merge verification (per AGENTS.md schema-change policy)

1. **T1 — schema deployed**: monitor `convex/_generated/` + dashboard for
   the `workspaceB2Retention` + `workspaceB2OrphanSweep` internal actions
   registering cleanly.
2. **T2 — read path**: open a workspace image gallery in apps/platform,
   confirm images render via B2 URLs (not legacy `ctx.storage.getUrl`).
3. **T3 — write path**: upload a new image to a workspace, confirm it
   uploads to B2 (not Convex storage) and renders correctly.
4. **T4 — daily cron**: at 03:00 UTC the next day, confirm
   `cleanupExpiredWorkspaceB2Uploads` runs without errors (Convex dashboard
   logs).
5. **T5 — weekly cron**: at 04:00 UTC next Sunday, confirm
   `cleanupOrphanB2Objects` runs without errors.

Track in HUC-57 — move to `In Progress` once PR is merged; `Done` once
T1–T5 all green.

## Key design decisions (unchanged)

### A) Soft-deprecate `storageId` (not drop)
- `storageId` column + `by_storageId` index retained on 4 tables
- Drop deferred to a follow-up PR after PR 2 backlog clears in production
- `cleanupMigratedConvexStorageBlobs` cron (PR 3a) keeps working
- `chatFileRetention.findLiveStorageReferences` keeps working

### B) apps/web NOT migrated to B2
- `apps/web/components/workspace/images.tsx` still calls
  `generateWorkspaceImageUploadUrl` → action gated behind `WORKSPACE_STORAGE_USE_B2`
- apps/web is the legacy client; apps/platform is the new one
- **CORS unblocked**: PR #891 ships `scripts/set-b2-bucket-cors.ts` and
  applies the canonical ruleset to the live `mentorship-workspace-storage`
  bucket (PUT + GET + HEAD; covers `https://mentorships.huckleberry.art`,
  apex wildcard, `*.vercel.app`, and localhost dev ports). When
  apps/web migration is ready, no additional CORS work is required
  — just flip `WORKSPACE_STORAGE_USE_B2=true` (tracked in HUC-60).

### C) Mutation args
- `embedImageInNote` / `createWorkspaceImageAndMessage` /
  `createWorkspaceFileMessage`: arg renamed `storageId` → `b2Key`
- `createWorkspaceImage`: accepts EITHER `storageId` (legacy apps/web) OR
  `b2Key` (new apps/platform)

### D) DB row shape
- B2 rows: `b2Key: <key>`, `imageUrl: ""` (placeholder), `storageId: undefined`
- Legacy rows: `storageId: <convex id>`, `b2Key: undefined`,
  `imageUrl: <resolved URL>`
- Gallery queries resolve legacy `imageUrl` server-side via
  `ctx.storage.getUrl`; B2 rows return `imageUrl: ""` and the UI resolver
  hook converts `b2Key` → URL

### E) Chat message content format
- File: `${encodeURIComponent(fileName)}|${b2Key}` (was `|${url}`)
- Image: `${b2Key}` (was `${url}`)
- UI resolver hook detects URL prefix (`https://`) vs b2Key

## Working environment (final)

- Use `NODE_OPTIONS="--max-old-space-size=8192"` for
  `pnpm --filter @mentorships/platform typecheck` (8GB heap)
- Root `pnpm typecheck` only covers apps/web, apps/marketing,
  packages/{db,payments,security} (project references) — NOT apps/platform
- Linear CLI wrapper: `node scripts/linear-cli.mjs teams` etc. — auth
  cached at `~/.local/share/opencode/mcp-auth.json`
- Greptile CLI: `npx greptile@latest review -b main`

## Reference docs

- `docs/plans/pr-11-workspace-storage-b2.md` — the PR 11 source-of-truth plan
- `AGENTS.md` — Linear + schema-change + Greptile + secret-protection policies
- `convex/_generated/ai/guidelines.md` — Convex ^1.44.0 guidelines
- `convex/cleanup/postMigrationStorageCleanup.ts` — template for cleanup action
- `apps/platform/lib/b2-workspace-upload.ts` — B2 helper

# PR 11 Plan: Workspace File Storage → Backblaze B2 (widen → migrate → narrow)

**Status (updated 2026-09-26):** PR 1 (widen) merged as commit `a7dbdfc9` on `main` (PR #872, 2026-09-24) after explicit user override of AGENTS.md merge policy (Greptile bot had not re-reviewed since round 17; local confidence 2/5; CodeRabbit skipped per 10-star rule). **PR 2 (migrate) merged as commit `b738eea5` on `main` (PR #876, 2026-09-26)** — the squash bundled the round-27 fixes (`7d8b85b0`) **plus the round-28 fixes** (`finalize-on-lock`, `STALE_MIGRATION_LOCK_MS`-gated lock takeover, retention-vs-propagation topology, and signed `x-amz-decoded-content-length`). The round-30 + round-31 follow-ups (per-row `now` plumbing in the Trigger sweep, workspace-vs-chat retention topology correction) are also in the squash. Greptile-bot round-27 (commit `2c208a97`, 4 P1 + 1 P2 at 1/5) and round-28 (post-`7d8b85b0`, 4 NEW P1s) both retroactively land on `main` via the squash. PR 3 (narrow + cutover flag + B2 lifecycle sweep) still pending.

**PR 2 commit plan (subject to Greptile + CodeRabbit review per AGENTS.md merge policy; do NOT merge without explicit user confirmation):**
- Schema: `fileUploads.migratedAt`, `fileUploads.scheduledBackfillAt`, index `by_b2Key_uploadedAt`.
- New constants in `convex/workspaceConstants.ts`: `BACKFILL_GRACE_MS = 7d`, `SCHEDULE_BACKFILL_DEDUP_MS = 6h`, `BACKFILL_BATCH_SIZE = 50`.
- New queries/mutations/actions in `convex/workspaceStorage.ts`: `listWorkspaceMigrationCandidates`, `getMigrationTargetById`, `markLedgerMigrated`, `stampBackfillSchedule`, `migrateConvexStorageRowToB2` (per-row action with `migrated | already_migrated | skipped_orphan | skipped_too_recent | skipped_no_storage` return enum), `getMigrationContext`, `backfillWorkspaceB2Storage` (page-bounded sweep), `deleteFromB2WorkspaceAction` (exposed for `chatFileRetention`), `putBlobToB2Workspace` (private helper).
- `convex/cleanup/chatFileRetention.ts`: branch cleanup on `b2Key !== undefined` → `deleteFromB2WorkspaceAction`; preserve ledger rows for migrated chat messages (download action depends on the ledger until PR 3).
- `src/trigger/migrateWorkspaceStorage.ts`: per-row task `migrateConvexStorageRowToB2` (3 retries, idempotent) + daily cron `workspaceStorageBackfillSweep` at 03:00 UTC.
- `scripts/migrate-workspace-storage.ts`: operator CLI with `--batch`, `--dry-run`, `--max-pages`.
- `convex/workspaceStorage.test.ts`: 9 tests covering candidate filter (grace, migrated, cancelled), idempotency, re-entrancy, target lookup, force-delete + ledger preservation.

## 1. Outcome

Move mentorship workspace file storage (images, chat files, note-comment attachments) out of Convex storage and into a dedicated Backblaze B2 bucket (`mentorship-workspace-storage`, region `us-east-005`). Convex storage remains the fallback path during the migrate phase and is removed entirely in the narrow phase.

Why: Convex storage egress is the dominant read cost for workspaces. B2 egress is included in the existing B2 plan and 100× cheaper per GB.

## 2. Key decisions (locked)

- **Bucket:** New `mentorship-workspace-storage` bucket in `us-east-005`, distinct from the existing `mentorship-call-storage` bucket. Key naming: `{date}/instructors/{instructorId}/students/{studentUserId}/workspaces/{workspaceId}/{fileId}/{fileName}` with org-style fallback `{date}/workspaces/{workspaceId}/{fileId}/{fileName}`.
- **Region env var:** `WORKSPACE_STORAGE_BUCKET_REGION` (new, only consumed in `convex/workspaceStorage.ts`). The existing `B2_REGION` env var stays `us-west-002` for the instructor bucket.
- **Bucket-name env var:** `WORKSPACE_STORAGE_BUCKET_NAME` (new, declared in `convex/convex.config.ts` `defineApp({ env: ... })`, synced via `trigger.config.ts` `syncEnvVars` `pushIfPresent`).
- **Cutover flag:** `workspaceStorageUseB2` (deferred to PR 3). PR 1 is purely additive; PR 2 migrates existing data; PR 3 narrows and adds the flag.
- **Retention:** 18 months after workspace end, mirroring `EIGHTEEN_MONTHS_MS` in `convex/queries/http.ts`. Files in ended workspaces remain downloadable during the retention window; download URLs are clamped to the retention deadline.
- **Auth:** Mirrors `convex/workspaces.ts:getWorkspaceRole` exactly. Admin role checked at query time (former admins do not retain). Confirmation re-checks authorization in the same transaction as the completion patch.
- **Widen-migrate-narrow:** PR 1 (this PR) adds B2 mint/download/bind actions + schema fields. PR 2 swaps the existing `ctx.storage.delete` → `deleteFromB2` calls and migrates existing rows. PR 3 narrows: drops the Convex-storage fallback paths, adds B2 lifecycle sweep + retention hard-delete cron, flips the cutover flag.

## 3. Out of scope (explicit non-goals)

- `instructorResources` storage (different bucket, different migration track).
- `workspaceNotes.imageUrl` (small avatar URLs, low cost, leave on Convex storage).
- Call recordings (separate `mentorship-call-storage` bucket, separate pipeline).
- Clerk configuration changes (per AGENTS.md Clerk Changes Policy).
- Cross-bucket migration tool (PR 3 covers the legacy Convex-storage → B2 sweep).

## 4. PR 1 — Widen (this PR, #872)

### Schema additions (`convex/schema.ts`)
- `workspaceNoteComments`, `workspaceImages`, `workspaceMessages`, `fileUploads`: add `b2Key: v.optional(v.string())` + `by_b2Key` index.
- `fileUploads`: add `completedAt: v.optional(v.number())` + `cancelledAt: v.optional(v.number())`. `storageId` relaxed to `v.optional` (so new rows skip Convex storage).
- Compound index `by_workspaceId_uploaderId_completedAt_uploadedAt` for the pending-count query.

### New module (`convex/workspaceStorage.ts`, 1500+ lines)
- **Helpers**: `buildWorkspaceStorageKey`, `loadB2Credentials`, `sha256Hex`, `hmacSha256`, `buildCanonicalQueryString`, `mintB2PresignedPutUrl`, `mintB2PresignedGetUrl`. SigV4 signs `host` + `x-amz-content-sha256` + `x-amz-date` + `x-amz-decoded-content-length` (PUT only).
- **Authorization resolvers** (`internalQuery`):
  - `resolveWorkspaceUploadAccess` — rejects ended workspaces.
  - `resolveWorkspaceDownloadAccess` — allows ended within retention.
  - `getWorkspaceEndedAt` — used by download expiry clamp.
  - `getB2ConfirmContext` — bundles ledger + workspace + user + instructor for `recordB2FileUpload` action body.
- **Mutation/action surfaces**:
  - `generateWorkspaceUploadUrl` (action) — mint-first-then-reserve, size validation, content-length signed PUT URL.
  - `reserveB2FileUploadLedger` (internalMutation) — atomic count + insert, `MAX_PENDING_UPLOADS_PER_WORKSPACE = 20`.
  - `getWorkspaceDownloadUrl` (action) — download gating, lifetime clamped to retention deadline.
  - `recordB2FileUpload` (action) — freshness via `B2_BINDING_AGE_MS` (60min), workspace recheck, caller check, `rejectionCleanupNeeded` gated cancellation, schedules cleanup via `cancelB2FileUpload` inner mutation.
  - `verifyAndConfirmB2Upload` (internalAction) — SigV4 HEAD; throws on 404.
  - `confirmB2FileUpload` (internalMutation) — re-checks workspace state + authorization inside its transaction (closes TOCTOU window during HEAD), marks cancelled + schedules cleanup if re-check fails.
  - `cleanupRejectedB2Upload` (internalAction) — SigV4 DELETE with exponential backoff (0/1s/4s/16s), permanent-vs-transient split (permanent 4xx logs and gives up; transient 5xx reschedules 5 min later; fetch wrapped in try/catch).
  - `cancelB2FileUpload` (internalMutation) — separate transaction so writes commit independently of the outer throwing mutation; skips scheduling cleanup if `completedAt` is set (concurrent completion race).
  - `markLedgerCancelled` (internalMutation) — used by retention cleanup.
  - `getFileUploadById` (internalQuery).

### Client helper (`apps/platform/lib/b2-workspace-upload.ts`)
- `validateB2Files`, `generateB2FileId`, `uploadFileToB2`, `resolveB2DownloadUrl`, `createB2ImagePreviews`.
- Passes `size: file.size` to the upload URL action.

### Package updates (`packages/storage/src/`)
- `client.ts`: re-exports `WORKSPACE_STORAGE_BUCKET_NAME` + `WORKSPACE_STORAGE_BUCKET_REGION` (default `us-east-005`); `B2_REGION` default stays `us-west-002`.
- `uploads.ts`, `downloads.ts`, `files.ts`, `list.ts`, `index.ts`: bucketName threading via `resolveBucket` helper + optional `bucketName` param. Backwards-compatible (existing callers without `bucketName` continue to use the instructor bucket).

### Convex config + trigger config
- `convex/convex.config.ts`: declares `WORKSPACE_STORAGE_BUCKET_NAME: v.optional(v.string())` in `defineApp({ env: ... })`.
- `trigger.config.ts`: `WORKSPACE_STORAGE_BUCKET_NAME` added to `syncEnvVars` `pushIfPresent` (so production secrets aren't overwritten by missing local values).

### Env-var inventory
- `WORKSPACE_STORAGE_BUCKET_NAME` (new) — bucket name.
- `WORKSPACE_STORAGE_BUCKET_REGION` (new) — `us-east-005` (defaults to it).
- `B2_KEY_ID` + `B2_APPLICATION_KEY` (existing) — used for both buckets.
- `B2_ENDPOINT` (existing) — used for both buckets.

### Greptile review history (PR 1)

Local CLI: 26 review rounds. Confidence oscillated 0–2/5 because Greptile flagged the same 3 false-positives across rounds 15–26:
1. `ctx.runMutation` from mutations (Convex docs confirm this is allowed and used).
2. Lowercase `x-amz-*` query params (AWS SigV4 spec is case-insensitive; lowercase works; `instructorUploads.ts` uses the same pattern and is in production).
3. PUT URL race window after cleanup (documented; PR 3 orphan sweep handles).

Real P1s addressed (each one accepted and fixed in the corresponding round):
- Round 8 (5d654c83): cleanup on rejected confirmation.
- Round 9 (ad4ad1b8): cancel via inner mutation so schedule survives throw.
- Round 10 (bbf7e557): only schedule cleanup when caller owns the key.
- Round 11 (fedd3038): harden download + cleanup recovery + cancel guards.
- Round 12 (c10acc35): sign cleanup DELETE with full header set; auth-loss cleanup.
- Round 13 (5aac8b5f): cleanup on missing/deleted workspace.
- Round 14 (2c72be87): permanent cleanup failures do not reschedule.
- Round 15 (8e15678a): catch fetch throws in cleanup; document PUT URL race.
- Round 16 (b1dbdde2): enforce 18-month retention deadline on download.
- Round 17 (57e67f4a): pending cap counts B2 rows only.
- Round 18 (4fe67d6e): HEAD-verify before confirm; clamp download URL to retention deadline.
- Round 19 (9662e6ef): re-check workspace state in confirm; skip cleanup if completed; reject download after retention deadline.
- Round 20 (801c1f90): confirm re-check failures delegate cancel via inner mutation to survive throw.

## 5. PR 2 — Migrate (planned, not yet implemented)

- Swap `ctx.storage.delete(storageId)` → `deleteFromB2(b2Key)` in `convex/cleanup/chatFileRetention.ts`.
- Backfill: for each row in `workspaceImages`, `workspaceMessages`, `workspaceNoteComments`, `fileUploads` with a Convex `storageId` and no `b2Key`, copy the object to the new B2 bucket, set `b2Key`, set `completedAt`, leave `storageId` in place (will be deleted in PR 3).
- New `@trigger.dev/sdk` task: `migrateConvexStorageRowToB2` — takes a `fileUploads._id`, reads the bytes via `ctx.storage.getUrl`, uploads to B2, patches the row.
- Concurrent-upload guard: only migrate rows where `uploadedAt < NOW - 7 days` (rows newer than a week may still be in flight).

## 6. PR 3 — Narrow (planned, not yet implemented)

- Add `workspaceStorageUseB2` env var; default `false`.
- Drop Convex-storage fallback paths in `generateWorkspaceUploadUrl`, `getWorkspaceDownloadUrl`, `recordB2FileUpload`.
- New cron: `cleanupExpiredWorkspaceB2Uploads` — runs daily, scans for rows with `completedAt + 18*30 days < NOW`, schedules `deleteFromB2` for each, marks the row `trashed`.
- New orphan sweep cron: `cleanupOrphanB2Objects` — lists B2 bucket objects, matches against `fileUploads` ledger, deletes objects with no ledger row.
- PR 3 cuts the cutover flag; PR 2 + PR 3 commits retain backwards-compat for callers.

## 7. Files touched (PR 1, complete list)

- `convex/schema.ts` — schema additions.
- `convex/convex.config.ts` — env-var declaration.
- `convex/workspaceConstants.ts` — `B2_BINDING_AGE_MS` + `WORKSPACE_RETENTION_MS`.
- `convex/workspaceStorage.ts` — full module (new file).
- `trigger.config.ts` — `syncEnvVars` entry.
- `packages/storage/src/client.ts` — re-exports.
- `packages/storage/src/{uploads,downloads,files,list,index}.ts` — bucketName threading.
- `apps/platform/lib/b2-workspace-upload.ts` — client helper (new file).
- `AGENTS.md` — `## Parallel Session Collision Prevention` section.

## 8. Merge-policy note

Per AGENTS.md pull-request merge policy: "Both Greptile and CodeRabbit should be visible and have approved the PR before merging; require approval from at least one." For PR #872 the situation is:

- **CodeRabbit:** skipped (repo has fewer than 10 stars; bot posted "skip review" notice). Skipped per policy.
- **Greptile bot:** reviewed once at round 17 (commit 57e67f4a) with confidence 0/5 and four P1s. Subsequent pushes for rounds 18–20 did not trigger a Greptile bot re-review (manual retrigger endpoint returns "Invalid request"). The local Greptile CLI review at round 26 reports confidence 2/5 with three persistent false-positives + one real P1 (r25 "Rejected upload cleanup rolls back") that was fixed in round 20.

Resolution: when the user is ready to merge, they should either (a) manually click the "Retrigger" link in the Greptile dashboard at `https://app.greptile.com/api/retrigger?id=69007541` to force a bot re-review, or (b) confirm the policy override explicitly per AGENTS.md: "If neither bot has responded AND the user explicitly asks to skip or override these checks, confirm the instruction before proceeding."

## 9. Open decisions

- None for PR 1.
- PR 2 trigger.dev task: should it run as a one-shot backfill (kick off once, complete in batches) or as a cron sweep? TBD when PR 2 lands.
- PR 3 orphan sweep cadence: daily is the current plan; revisit after observing B2 bucket growth rate.

## 10. Related docs

- `convex/instructorUploads.ts` — existing B2 path used as the SigV4 reference (`getAwsSigV4Signature`, `deleteFromB2`).
- `convex/workspaces.ts` — `getWorkspaceRole` (auth pattern mirrored).
- `convex/queries/http.ts` — `EIGHTEEN_MONTHS_MS` (mirrored as `WORKSPACE_RETENTION_MS`).
- `convex/cleanup/chatFileRetention.ts` — PR 2 swaps the storage call.
- AGENTS.md §Pull Request Merge Policy + §Parallel Session Collision Prevention.

## 10.1 PR 2 new files

- `src/trigger/migrateWorkspaceStorage.ts` — per-row Trigger.dev task + daily cron. Reuses `ConvexHttpClient` + `setAdminAuth(CONVEX_HTTP_KEY)` (mirrors `recording-transfer.ts`).
- `scripts/migrate-workspace-storage.ts` — operator CLI for on-demand sweeps or backstop if the cron is paused. `--dry-run` uses the candidate query directly (no B2 traffic).
- `convex/workspaceStorage.test.ts` — 9 convex-test cases. Convex-test cannot reach B2, so the per-row state machine + post-filters are tested; integration bytes verified in staging.

## 10.2 PR 2 follow-ups

### Greptile round 27 review of PR 2 (commit `2c208a97`, branch `feat/workspace-storage-pr2`)

GitHub bot auto-review posted confidence **1/5** with **four P1s + one P2**. Local CLI review corroborated. All five addressed in commit `7d8b85b0` on the same branch:

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | P1 | Migration writes `b2Key` only to the `fileUploads` ledger; chat messages keep no `b2Key`, so cleanup takes the legacy `ctx.storage.delete(storageId)` branch and orphans the B2 object | New `propagateMigratedB2KeyToMessages` mutation patches `b2Key` onto every `workspaceMessages` row sharing the `storageId`, called from `migrateConvexStorageRowToB2` after the B2 PUT + finalize |
| 2 | P1 | `stampBackfillSchedule` used an unindexed `q.filter(q.and(q.gte(...), q.neq(...)))` scan over the entire `fileUploads` ledger — exceeded Convex read budget at scale | Removed the dedup branch; `stampBackfillSchedule` is now a single-row heartbeat via the existing `by_b2Key_uploadedAt` index. Cron relies on Trigger.dev's schedule + per-row `migrateConvexStorageRowToB2` idempotency |
| 3 | P1 (related to #2) | The stamp-before-schedule dedup blocked retries if the sweep failed partway | Same fix as #2 — no dedup, partial failures are caught by the next day's tick |
| 4 | P1 | PUT-to-B2 succeeds but `markLedgerMigrated` fails (e.g., ledger deleted in race window) → orphan B2 object, retry can't recover | New `acquireMigrationLock` mutation sets `migratedAt = lockAt` BEFORE the PUT; `forceDeleteExpiredChatMessageRow` now preserves the ledger when `migratedAt !== undefined` (in-progress lock); new `releaseMigrationLock` clears the lock on PUT failure so the next tick can retry |
| 5 | P2 | `sha256Hex(await params.blob.arrayBuffer())` allocated a full-size ArrayBuffer just to compute a body hash the server doesn't validate | Switched `putBlobToB2Workspace` PUT to use `x-amz-content-sha256: UNSIGNED-PAYLOAD` (mirrors the DELETE helper) with `x-amz-decoded-content-length` enforcing size; memory stays at the streaming size of the `Blob` |

Re-entrancy model after the fix: cron runs unconditionally every 24h at 03:00 UTC; each row is processed by an idempotent per-row Trigger.dev task that short-circuits on `b2Key !== undefined || migratedAt !== undefined`. Heartbeat stamp is best-effort and never gates the sweep.

Test coverage added: 8 new convex-test cases (`acquireMigrationLock` accept/refuse on locked/migrated, `releaseMigrationLock` clear + no-op, `propagateMigratedB2KeyToMessages` patch + skip-already-set, `forceDeleteExpiredChatMessageRow` lock-preservation, plus the reworked `stampBackfillSchedule` heartbeat test). 17 total in `convex/workspaceStorage.test.ts`.

### Greptile round 28 review of PR 2 (commit `7d8b85b0`, branch `feat/workspace-storage-pr2`)

Posted after the round-27 fix; the bot flagged **four NEW P1s** that the lock + propagation + UNSIGNED-PAYLOAD fix shape created:

| # | Severity | Finding | Resolution (now on `main` via `b738eea5`) |
|---|----------|---------|--------------------------------------------|
| 1 | P1 | **Migration never finalizes.** Round-27 `markLedgerMigrated` short-circuited on `migratedAt !== undefined`, but the lock step sets `migratedAt` BEFORE the PUT. Every successful PUT leaves its B2 copy unrecorded on the ledger. | `markLedgerMigrated` now keys idempotency off `b2Key !== undefined` alone; lock-based `migratedAt` is overwritten with the migration's `lockAt` + `completedAt`. See `convex/workspaceStorage.ts:1791-1823`. |
| 2 | P1 | **Interrupted migrations stay locked.** Action crash between lock and PUT left `migratedAt` set without `b2Key`; next trigger short-circuited. | `acquireMigrationLock` takes over locks older than `STALE_MIGRATION_LOCK_MS` (1 h by default — covers the B2 PUT URL binding window). See `convex/workspaceStorage.ts:1834-1870`. New constant in `convex/workspaceConstants.ts`. |
| 3 | P1 | **Retention can leave B2 copies.** Greptile initially proposed auto-deleting on `propagate` zero rows, but Greptile round 30 + round 31 review corrected the cleanup topology: the workspace ledger may legitimately reference a workspace-only download even with zero `workspaceMessages` matches, so an unconditional delete-on-zero would regress legitimate workspace downloads. | Migration action does NOT delete on zero-row propagate. Orphan-B2 cleanup is deferred to **PR 3's B2 lifecycle sweep** (`workspaceStorageUseB2` cutover scope). Within PR 2, the migration action tolerates a retention race by leaving the B2 object reachable via the workspace ledger for the workspace's lifetime. See `convex/workspaceStorage.ts:1733-1776` and the analogous correction in `convex/cleanup/chatFileRetention.ts:351-381`. |
| 4 | P1 | **PUT header is unsigned.** SigV4 requires every `x-amz-*` request header to also appear in `SignedHeaders` + `canonicalHeaders`; the round-27 helper sent `x-amz-decoded-content-length` without signing it. | `putBlobToB2Workspace` adds `x-amz-decoded-content-length` to both `signedHeaders` (line 2212) and `canonicalHeaders` (line 2219) blocks. See `convex/workspaceStorage.ts:2176-2229`. |

All four round-28 fixes landed on `main` via the `b738eea5` squash; verified by `convex/workspaceStorage.test.ts` (21/21 pass; 4 round-28-specific cases at L642, L677, L706 + `STALE_MIGRATION_LOCK_MS` constant test). `pnpm run typecheck` clean; `pnpm run lint` clean (0 errors).

### Stage rehearsal (next, before PR 3)

- Round-27 + round-28 fixes are already on `main` (verified via `convex/workspaceStorage.test.ts` 21/21 + tsc + lint). The four round-28 verify points become **T-1..T-4 in HUC-51** instead of pre-PR-3 stage work.
- Verify `migrateConvexStorageRowToB2` against a snapshot-seeded preview deployment with a small `<10 row` test set; confirm `markLedgerMigrated` does not race with concurrent `confirmB2FileUpload` paths (PR 1 mint/bind); run `chatFileRetention` cleanup tick against a seeded workspace with mixed migrated + legacy rows. This is the **only** outstanding stage rehearsal before PR 3.
- PR 3's scope (narrow + cutover flag): drop Convex-storage fallback paths; add B2 lifecycle sweep (orphaned-object cleanup deferred from round 28 P1 #3); flip `workspaceStorageUseB2`; add retention hard-delete cron.

### Prod verification (HUC-51)

- Linear issue tracks the post-merge T1–T5 smoke tests. With the round-28 fixes already on `main`, the four findings become post-merge verification points (T-1..T-4) instead of pre-PR-3 blockers:
  - [x] After a successful migration, `b2Key` + `completedAt` are present on the ledger (round 28 P1 #1) — **verified by `markLedgerMigrated writes b2Key when lock is held` test at `convex/workspaceStorage.test.ts:642`**.
  - [x] A Trigger.dev crash mid-migration does not permanently lock the row (round 28 P1 #2) — **verified by `acquireMigrationLock takes over stale locks` test at `convex/workspaceStorage.test.ts:677` + `STALE_MIGRATION_LOCK_MS` constant test at `:706`**.
  - [ ] A retention race during in-flight migration does not orphan a B2 object (round 28 P1 #3) — **PR 3's B2 lifecycle sweep closes this loop; pre-PR-3 the B2 object remains reachable via the workspace ledger for the workspace's lifetime.**
  - [ ] `putBlobToB2Workspace` PUT requests sign `x-amz-decoded-content-length` and the bucket accepts them (round 28 P1 #4) — **unit-verified via the signed-headers list at `convex/workspaceStorage.ts:2207-2219`; requires a live-B2 smoke test against the actual bucket to confirm the signature validates end-to-end.**

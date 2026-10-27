# Daily → B2 recording cleanup: scope of work

Status: in progress
Owner: platform
Refs: Muse AI assessment (2026-10-27), `mentorships-infra-daily-b2-cleanup.patch`

## Problem

`transfer-daily-recording-to-b2` moves a Daily.co cloud recording into B2 and
then deletes the Daily source. Three defects make that last step unsafe or
unrecoverable:

1. **No independent B2 verification.** "Confirmed in B2" means the
   `PutObjectCommand` did not throw. The streamed byte count and ETag are logged
   but never read back.
2. **Failed Daily deletes are swallowed.** The `try/catch` logs a warning and
   the task returns success; Convex records nothing.
3. **No delete-only recovery path.** The transfer retry route 404s once
   `recordingUrl` exists, so an orphaned Daily copy can only be removed through
   Daily's API or by waiting for Daily's 7-day purge.

## Goals

- Verify the B2 object (existence, non-empty, size match) before deleting the
  Daily source.
- Persist Daily-side cleanup outcomes separately from B2 transfer outcomes so a
  failed delete never hides a playable recording.
- Provide an instructor-only, idempotent way to re-run only the Daily delete.
- Keep the B2 key scheme (`recordings/{sessionId}/{recordingId}.mp4`),
  retention logic, and transfer-retry behaviour unchanged.

## Non-goals

- No UI in this arc. The delete-daily endpoint is API-only; a failed-cleanup
  affordance and drift-monitor surfacing are follow-ups.
- No backfill of legacy rows. `undefined` cleanup state is treated as
  "not yet tracked" and handled by the delete-daily route.
- No change to Clerk configuration, auth model, or storage package exports.
- No new environment variables (the Trigger task already syncs
  `DAILY_API_KEY`, `CONVEX_HTTP_KEY`, `CONVEX_TRIGGER_CALLBACK_SECRET`).

## Design

### Data model (widen only)

`convex/schema.ts`, `sessions`:

| Field | Type | Meaning |
| --- | --- | --- |
| `recordingDailyCleanupStatus` | `"pending" \| "done" \| "failed"` | Daily-side cleanup state; independent of `recordingTransferStatus`. |
| `recordingDailyCleanupError` | `string` | Last cleanup error. |
| `recordingDailyCleanupAttempts` | `number` | Monotonic count of cleanup **runs started** (not individual DELETE calls). Used to derive idempotency keys. |
| `recordingDailyCleanupUpdatedAt` | `number` | Last cleanup-state transition; drives drift detection. |

`undefined` = legacy row or attach has not run. A `failed` cleanup keeps
`recordingTransferStatus === "ready"` and `recordingUrl` intact: the B2 copy is
playable, and retention only purges `ready` rows, so flipping the transfer
status would leak B2 storage.

### Mutations (`convex/sessions.ts`, internal only)

- `attachRecordingFromB2Upload`: additionally sets cleanup `pending`, clears the
  error, and stamps `recordingDailyCleanupUpdatedAt`. Early-returns on `ready`,
  so it cannot reset a completed cleanup.
- `markRecordingDailyCleanupRetrying`: increments `recordingDailyCleanupAttempts`
  by one, sets `pending`, clears the error, stamps `updatedAt`, returns the new
  count. Called by the delete-daily route **before** triggering, so the
  idempotency key is monotonic by construction.
- `markRecordingDailyCleanupDone`: idempotent; returns `alreadyDone` when
  already `done`.
- `markRecordingDailyCleanupFailed`: stores the error, sets `failed`, stamps
  `updatedAt`. **Ignores a stale failure when already `done`** (a concurrent run
  that succeeded must not be regressed). Never touches transfer status or URL.

### HTTP callbacks (`convex/http.ts`)

Three routes with the existing two-key auth (`CONVEX_HTTP_KEY` +
`X-Trigger-Callback-Secret`):

- `POST /recording-transfer/mark-daily-cleanup-retrying`
- `POST /recording-transfer/mark-daily-cleanup-done`
- `POST /recording-transfer/mark-daily-cleanup-failed`

### Transfer task (`src/trigger/recording-transfer.ts`)

- After upload, before attach: HEAD the B2 key via the storage package's
  `headFile`. Require exists, non-empty, and size equals the streamed byte count.
  Any mismatch throws so Trigger retries and the Daily copy is preserved.
- Replace the warn-only delete with `attemptDailyCleanup`: up to 3 DELETE
  attempts (2s, 5s backoff; Daily DELETE is idempotent and 404 = success). On
  success, mark done (a failed done-callback is logged only). On exhaustion,
  mark failed, then still return success — a Daily delete failure is not a
  transfer failure.
- `deleteOnly` mode: skip access-link/download/upload/attach **and**
  `mark-retrying` (which would flip a `ready` row back to `uploading`). Verify
  the B2 key by HEAD (existence + non-empty only) and run the same cleanup
  helper. In `catchError`, a delete-only final failure records cleanup failure,
  never transfer failure.

### Delete-only route

`POST /api/video/recording/[sessionId]/delete-daily`:

1. Clerk auth + Convex token; participant gate via
   `getSessionParticipantForRecording`; instructors only (students 403).
2. 404 when session missing, no `recordingUrl`, cleanup already `done`, or the
   key is not a `recordings/` B2 key.
3. 409 when `recordingTransferStatus !== "ready"` or `recordingId` missing.
4. `mark-daily-cleanup-retrying` → `attempts`, key
   `delete-daily-recording:{sessionId}:{recordingId}:{attempts}`.
5. Trigger the task with `{ deleteOnly: true, b2Key: session.recordingUrl }`;
   on trigger failure, compensate with `mark-daily-cleanup-failed` and return
   502.

## Delivery plan

### PR 1 — cleanup state + verification + delete-only recovery (this PR)

- Schema widen, mutations, HTTP callbacks, task changes, route, tests.
- Closes the three defects.
- Verification: new Convex tests, full `pnpm test:convex`, Convex and platform
  typechecks, ESLint on the new route.
- Post-merge verification issue (Linear) with T1–T5 below.

### PR 2 (follow-up) — observability

- Extend `convex/audit/recordingTransferAudit.ts` with `cleanupPendingStuck`
  (>10 min) and `cleanupFailed` buckets, using `recordingDailyCleanupUpdatedAt`.
- Emit counts through the existing hourly drift cron.

### PR 3 (follow-up) — operator/UI affordance

- Surface failed-cleanup recordings in `apps/platform/components/workspace/calls-tab.tsx`
  with a "Retry cleanup" action wired to the delete-daily route.
- Keep the B2 recording playable; the affordance only clears the Daily copy.

### PR 4 (follow-up, optional) — code quality

- Extract `verifyB2Recording` / `attemptDailyCleanup` into a testable module with
  mocked storage + Daily calls.
- De-duplicate the participant gate and callback plumbing shared by the retry
  and delete-daily routes.

## Deploy order (critical)

1. Merge. `convex-deploy.yml` deploys Convex automatically on `convex/**`.
2. Confirm the new callbacks are live.
3. Deploy the Trigger task manually (`npx trigger.dev@4.5.15 deploy`) with the
   required secrets.

Deploying the task first is safe for playback but not for state: the new task's
cleanup callbacks 404, leaving rows `pending`/`undefined` until a later run.
Because idempotency keys persist for 30 days, a key derived from a
non-advancing counter would also suppress retries — the route's pre-trigger
increment exists to prevent exactly that.

## Post-merge verification (Linear issue)

- **T1** — Schema deployed: a new transfer lands `ready` **and** cleanup
  `done`.
- **T2** — Playback/download of that recording still works.
- **T3** — Forced Daily 5xx in preview (404 counts as success, so a bad ID is
  not enough) lands `ready` + cleanup `failed`; recording remains playable.
- **T4** — Delete-daily clears it (202 → `done`); a second call returns 404.
- **T5** — No `pending` cleanup rows beyond the expected window; drift audit
  reviewed after PR 2 lands.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Deleting the Daily source after a bad upload | Independent HEAD verification before delete. |
| Failed delete hides a playable recording | Cleanup state is separate; transfer status untouched. |
| Retry endpoint is a no-op after a silent failure | Counter increments before trigger; monotonic idempotency key. |
| Stale failure overwrites a success | `markRecordingDailyCleanupFailed` ignores rows already `done`. |
| B2 purge races cleanup | Retention only touches `ready` rows; Daily auto-purges at 7 days. |
| Deploy-order skew | Convex first, Trigger second; documented here and in the PR. |

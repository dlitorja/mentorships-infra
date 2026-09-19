# Recording Ready Notifications — 4-PR Arc

Notify the workspace owner (student) when a call recording finishes transferring to Backblaze B2 and is actually visible in their workspace Videos tab. Two channels: in-app bell row + Resend email, with a per-student email toggle in the Videos tab UI.

**Status**: PR #1 merged (commit `4c5a7fd5`, 2026-09-18). PR #2 merged (commit `930ab9ce`, 2026-09-18). PR #3 in progress.

## Problem statement

The Daily.co → B2 transfer pipeline (`convex/dailyRecordingActions.ts` → `src/trigger/recording-transfer.ts` → `internal.sessions.attachRecordingFromB2Upload`) flips `sessions.recordingTransferStatus: "ready"` as soon as the MP4 is in B2. Today there is **no notification** to the student:

- The sidebar bell (`apps/platform/components/notifications/notification-bell.tsx`) reads only `inCallNotifications` (ad-hoc call invites, `convex/schema.ts:864`). No `recording_ready` kind exists.
- `attachRecordingFromB2Upload` (`convex/sessions.ts:1382`) only patches the session row. No `ctx.db.insert(...)` into any notification table, no Resend call.
- `convex/notifications.ts:277` `NotificationType` literals are `renewal_reminder | final_renewal_reminder | grace_period_final_warning` only (session-pack renewals, not recordings).
- The only recording-related in-app surface today is `RecordingRetentionWarningBanner` — it surfaces expiry, not availability.

So the moment a recording finishes uploading, the only signal is the student happening to click the Videos tab.

## Scope decisions (locked in with operator)

- **Recipients**: workspace owner (student) only. Instructors excluded.
- **Channels**: in-app bell row + Resend email. No Discord in this PR (clean follow-up if desired).
- **Toggle**: per-student checkbox in the Videos tab UI; persists to `users.notificationPreferences`. Default `true` (opt-out).
- **Visibility gate**: do NOT notify until the recording actually surfaces in the student's `getCallRecordingsForWorkspace` result. The gate handles three failure modes that the existing pipeline doesn't: (a) `sessions.workspaceId` unresolved for an ad-hoc session, (b) the `by_instructor_student_hasRecordingArtifact_callStartedAt` index hasn't seen the row yet, (c) the migration `backfillSessionWorkspaceLinks` hasn't run yet.

## Architecture

### Data model (widen phase — PR #1)

`convex/schema.ts`:

```ts
recordingReadyNotifications: defineTable({
  sessionId: v.id("sessions"),
  workspaceId: v.id("workspaces"),
  recipientUserId: v.string(),            // bare Clerk userId (student)
  recordingStartedAt: v.number(),
  recordingCallEndedAt: v.optional(v.number()),
  // state machine:
  //   pending_visibility → ready_to_send → sent
  //                                  ↘ failed
  deliveryStatus: v.union(
    v.literal("pending_visibility"),
    v.literal("ready_to_send"),
    v.literal("sent"),
    v.literal("failed")
  ),
  sentAt: v.optional(v.number()),
  providerEmailId: v.optional(v.string()),
  deliveryError: v.optional(v.string()),
  acknowledgedAt: v.optional(v.number()),
})
  .index("by_sessionId", ["sessionId"])
  .index("by_recipientUserId", ["recipientUserId"])
  .index("by_sessionId_recipientUserId", ["sessionId", "recipientUserId"])
  .index("by_deliveryStatus", ["deliveryStatus"]);

// users table — JSON blob for cross-device notification preferences.
notificationPreferences: v.optional(v.any()),
```

`v.optional(v.any())` mirrors existing patterns (`instructors.workingHours`, `instructors.socials` — `convex/schema.ts:40,65`).

### New Convex query (PR #1)

`convex/sessions.ts`: `getSessionVisibilityForStudentOwner` (internalQuery). Runs the same `by_instructor_student_hasRecordingArtifact_callStartedAt` predicate as `getCallRecordingsForWorkspace`, narrowed to a single sessionId. Returns:

```ts
{ visible: boolean, workspaceId?: Id<"workspaces">, reason: "ok" | "no_workspace" | "not_owner" | "no_recording_artifact" | "recording_not_ready" }
```

### New HTTP routes (PR #1)

`convex/http.ts` (two-key auth: `CONVEX_HTTP_KEY` + `X-Trigger-Callback-Secret`):

- `POST /recording-ready/enqueue` — Trigger.dev task writes the initial `pending_visibility` row.
- `POST /recording-ready/visibility` — Trigger.dev task reads the visibility-gate predicate (used by the task on each attempt; replaces direct Convex HTTP query since internal queries aren't callable from outside the Convex runtime).
- `POST /recording-ready/mark-ready-to-send` — Trigger.dev task flips `deliveryStatus: "pending_visibility → ready_to_send"` once the gate passes.
- `POST /recording-ready/mark-sent` — Trigger.dev task flips `deliveryStatus: "ready_to_send → sent"` after a successful email send, with `providerEmailId`.
- `POST /recording-ready/mark-failed` — Trigger.dev task (or admin sweep) flips to `failed` from any non-terminal state, with `deliveryError` annotation.

### New Trigger.dev task (PR #1)

`src/trigger/notify-recording-ready.ts`:

1. Idempotency key: `notify-recording-ready:{sessionId}`.
2. Retry: `maxAttempts: 5`, `factor: 2`, mirrors `transfer-daily-recording-to-b2`.
3. **Visibility gate loop**:
   - Call `internal.sessions.getSessionVisibilityForStudentOwner({sessionId})` via Convex HTTP.
   - If `visible === false` and attempts < 5: `await wait.for({ minutes: 1 })`, retry.
   - If `visible === true`: enqueue the row (`pending_visibility → ready_to_send`) and write the `enqueue` callback.
   - If `visible === false` after 5 attempts: write `deliveryStatus: "failed"`, `deliveryError: "visibility_timeout"`. Skip the email (PR #2 will wire that part).
4. PR #1 scope: the task does NOT send email. It writes the `pending_visibility` row, runs the visibility gate, and stops. Email is PR #2.

### Chaining from the B2 transfer

`convex/sessions.ts` `attachRecordingFromB2Upload` (line 1382) currently patches the session and returns. In PR #1, after the patch succeeds, fire the Trigger task by HTTP-POSTing to the Trigger REST API, mirroring `triggerTransferTask` (`convex/dailyRecordingActions.ts:116`):

```ts
await fetch("https://api.trigger.dev/api/v1/tasks/notify-recording-ready/trigger", { ... });
```

Idempotent: if the B2 callback fires twice (Trigger retry + Convex success), the early-return on `status === "ready"` (`sessions.ts:1403`) prevents a second enqueue. The Trigger task's idempotency key on `sessionId` is a second guard.

## PR breakdown

| # | PR | Schema touched? | What ships |
|---|----|----|----|
| 1 | **Schema widen + visibility gate** | ✅ yes (`recordingReadyNotifications` table, `users.notificationPreferences` field) | New table, new field, internal query, new HTTP routes, Trigger task that runs the visibility gate (writes `pending_visibility` → `ready_to_send` row; does NOT email yet) |
| 2 | **Email send** | no | Resend template + email fanout wired into the Trigger task. Respects `users.notificationPreferences.recordingReadyEmail`. |
| 3 | **Bell wiring** | ✅ widens `inCallNotifications.kind` | Bell renders both call invites + recording-ready rows. New deep-link route param `?videos={sessionId}`. **Merged** as PR #852 (`945850f1`). |
| 4 | **Videos tab UI toggle** | no | Inline card in `calls-tab.tsx`, per-student switch (role-gated, optimistic UI). Backfill: `migrations:backfillNotificationPreferences` sets default `true` for all existing students. **Open** as PR #853 (`058c22e1`). |

## Files

| File | Change |
|---|---|
| `convex/schema.ts` | `recordingReadyNotifications` table, `inCallNotifications.kind` widen (PR #3), `users.notificationPreferences` (PR #1) |
| `convex/sessions.ts` | `getSessionVisibilityForStudentOwner` internalQuery (PR #1); patched `attachRecordingFromB2Upload` to chain `chainNotifyRecordingReady` after the session patch (PR #1) |
| `convex/recordingReadyNotifications.ts` | NEW. CRUD + state-machine mutations + `chainNotifyRecordingReady` action + `triggerNotifyRecordingReady` retry helper (PR #1) |
| `convex/http.ts` | 5 `/recording-ready/*` HTTP routes — `enqueue`, `visibility`, `mark-ready-to-send`, `mark-sent`, `mark-failed` (PR #1) + `get-recipient-info` (PR #2). 6 total. |
| `convex/recordingReadyNotifications.test.ts` | NEW. 34 convex-test cases: 6 visibility branches + 6 state-machine + 4 action-retry (PR #1) + 4 query tests (PR #2) + 14 PR #3 bell tests (12 listUnreadForUser + markAcknowledged + 1 R1 regression for the >50 historical rows case). |
| `convex/recordingReadyHttp.test.ts` | NEW. 10 convex-test cases for the 6 HTTP routes (PR #1 + PR #2). |
| `packages/emails/src/recording-ready.ts` | NEW. Resend template (PR #2). |
| `packages/emails/src/recording-ready-decision.ts` | NEW. Pure `decideRecordingReadyEmailOutcome` function — the 5-branch email decision tree (PR #2). |
| `packages/emails/src/recording-ready-decision.test.ts` | NEW. 15 vitest cases covering all 6 branches + branch-ordering edge cases (PR #2). |
| `convex/users.ts` | `setNotificationPreference` public mutation (PR #4) |
| `convex/inCallNotifications.ts` | widen `kind` to include `recording_ready` (PR #3) |
| `convex/notifications.ts` | add `recording_ready` to `NotificationType` union, build email (PR #2) |
| `convex/migrations/backfillNotificationPreferences.ts` | NEW. Backfill default `recordingReadyEmail: true` for existing students (PR #4) |
| `src/trigger/notify-recording-ready.ts` | NEW. Visibility gate (PR #1), email send (PR #2 — thin wrapper around `decideRecordingReadyEmailOutcome`). Terminal reasons = `no_recording_artifact`, `recording_not_ready` (NOT `no_workspace` — fixed in PR #1 Greptile R1). Outer `outcome` union = `sent`/`opted_out`/`no_email`/`dev_skipped`/`ready_to_send`/`failed` (PR #2 Greptile R1 fix). |
| `apps/platform/components/workspace/calls-tab.tsx` | toggle card (PR #4), deep-link param (PR #3) |
| `apps/platform/components/notifications/notification-bell.tsx` | render `recording_ready` entries (PR #3) |
| `apps/platform/components/email/recording-ready.tsx` | NEW. Resend template (PR #2) — note: actually landed in `packages/emails/src/recording-ready.ts` per the workspace package convention |

## Verification

### Unit (convex-test)

`convex/sessions.test.ts` (or new file `recordingReadyNotifications.test.ts`):

- `getSessionVisibilityForStudentOwner` covers all 5 reason branches: `ok`, `no_workspace`, `not_owner`, `no_recording_artifact`, `recording_not_ready`.
- `recordingReadyNotifications` mutation state machine: pending_visibility → ready_to_send → sent; failed terminal state on visibility timeout.
- `/recording-ready/*` HTTP routes: 401 without auth headers (mirrors `recordingTransferHttp.test.ts`), 200 + actual row write on happy path.

### Smoke (PR #1 specifically)

- Trigger a real ad-hoc call in a test workspace, end the call.
- Verify the Trigger run for `notify-recording-ready` completes with `deliveryStatus: "ready_to_send"` within ~5 minutes.
- Verify NO email is sent yet (PR #1 does not wire email).
- Verify the row exists in `recordingReadyNotifications` and surfaces in admin queries.

### Smoke (PR #2 — after PR #2 lands)

- End-to-end: a real call produces both a bell row + a Resend email with the correct deep-link.
- Negative: a student with `recordingReadyEmail: false` gets a bell row but no email.
- Visibility-gate exhaustion: temporarily revert `backfillSessionWorkspaceLinks` → confirm no email is sent, bell row stays `pending_visibility`, admin sweep surfaces it.

## Linear tracking

- Project: **Recording Ready Notifications** (new).
- PR #1 issue under the project: engineering task. Verification issue in **Schema Changes** project (PR #1 widens `recordingReadyNotifications` table + `users.notificationPreferences` field).
- PR #2 issue under the project: engineering task. Verification issue in **Recording Ready Notifications** project (PR #2 does NOT touch schema — reads only `users.notificationPreferences` via the new `getRecipientInfoForNotification` query).
- PR bodies use `Refs HUC-XX` (not `Fixes`).

## PR #2 Greptile R1 fix notes (2026-09-18)

PR #2 (`930ab9ce`) shipped on first merge round with Greptile confidence 5/5 ("appears safe to merge") on commit `907bf846`. Two findings from the initial review were resolved before merge:

* **P1 (missing `dev_skipped` outcome type)**: the outer `outcome` union in the Trigger task return type was missing `"dev_skipped"`. Added explicitly in commit `907bf846`.
* **P2 (email branches lack tests)**: extracted the 5-branch decision into a pure `decideRecordingReadyEmailOutcome` function in `packages/emails/src/recording-ready-decision.ts` (no `@trigger.dev/sdk`, `sendEmail`, or `fetch` deps). 15 vitest cases in `packages/emails/src/recording-ready-decision.test.ts` cover all 6 outcome paths plus branch-ordering edge cases — no mocks needed.

The pure-function extraction is the durable pattern: the `dispatchRecordingReadyEmail` wrapper is now thin (build `sendResult` → call decision → apply `sideEffect` callback → shape for Trigger log). Future email branches can be unit-tested by extending the decision function's branches, not by mocking `@trigger.dev/sdk`.

## PR #3 Greptile R1 fix notes (2026-09-19)

PR #3 (`945850f1`) shipped after Greptile R1 (Confidence 2/5) → R2 (Confidence 5/5, "appears safe to merge"). Three P1 findings from the initial review were resolved in commit `328b1cb5` before merge:

* **P1 #1 (Unread rows are omitted from the bell)**: `listUnreadForUser` previously did `.take(50)` on the single-field `by_recipientUserId` index and post-filtered for `acknowledgedAt === undefined`. A user with >50 historical rows (mostly acknowledged) would have newer un-acked rows fall outside the take window and never appear in the bell. Added a `by_recipientUserId_acknowledgedAt` compound index; `listUnreadForUser` now queries `.eq("acknowledgedAt", undefined)` so the take cap applies only to the un-acked set (which is the right defense). Regression test (`listUnreadForUser: returns un-acked rows even when user has >50 historical rows`) seeds 60 acknowledged + 5 un-acknowledged rows and asserts the 5 un-acked entries come back.
* **P1 #2 (Deep links miss later pages)**: the previous `<DeepLinkScroller />` ran once on mount and no-op'd if the target card wasn't in the first 25 loaded recordings, while `<RecordingAcknowledgedMarker>` silently acked the notification regardless. Consolidated pagination + scroll + ack into a single `<RecordingDeepLinkHandler>` inside `<WorkspaceCalls>` so all three share the same data scope. The handler iterates `fetchNextPage()` until the target is found (capped at `MAX_DEEP_LINK_PAGES = 8` to defend against bad URLs) and only fires `markAcknowledged` AFTER the card is rendered. A `useRef` guard prevents double-fire across React strict-mode double-mount; the underlying mutation is itself idempotent for defense in depth.
* **P1 #3 (Cross-workspace ack)**: `<RecordingAcknowledgedMarker>` matched unread notifications by `sessionId` alone, so a user with access to workspaces A and B could land on A with `?videos={sessionId-from-B}` and silently ack B's notification. Removed the standalone marker from the route page; the handler now requires BOTH `sessionId === initialSessionId` AND `workspaceId === workspaceId` before firing the mutation.

## Rollback (per PR)

Each PR is independently revertible. The schema-touching PRs (PR #1, PR #3) follow the widen-migrate-narrow contract: schema widens first, then any narrow follows in a later PR after the schema change is verified on prod. Convex retains dropped tables' data for a soft-delete grace period, so even a PR #1 rollback keeps the new `recordingReadyNotifications` rows readable (just orphaned).

## Reference docs

- `convex/dailyRecordingActions.ts` — Daily → B2 transfer trigger source.
- `src/trigger/recording-transfer.ts` — existing Trigger task this builds on.
- `convex/sessions.ts:1955` `getCallRecordingsForWorkspace` — the query whose result is the visibility gate.
- `convex/http.ts:2272` — existing `/recording-transfer/*` HTTP callback pattern this mirrors.
- `apps/platform/components/notifications/notification-bell.tsx:39` — the bell surface PR #3 widens.

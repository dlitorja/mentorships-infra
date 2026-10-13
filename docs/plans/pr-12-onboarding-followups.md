# Onboarding Follow-ups (PR 12 — post-merge remediations)

**Status:** drafted 2026-10-12. Arc state (2026-10-13): **4/4 shipped**, HUC-95 merged; surrounding verification issues in prod Phase-1 windows.

| Linear | Topic | PR # | Squash commit | Status |
|---|---|---|---|---|
| HUC-92 | Webhook race (`user.created` lag) | PR #923 | `70e6b2ae` | shipped (2026-10-13) — verification HUC-96 in prod Phase-1 window |
| HUC-94 | `route.test.ts` for `/api/onboarding/*` + conformance reporter | PR #924 | `601e6f90` | shipped (2026-10-13) |
| HUC-93 | `force:true` recency gate (two-tab clobber race) | PR #925 | `54a755e9` | shipped (2026-10-13) — verification HUC-97 in prod Phase-1 window |
| HUC-95 | Notify assigned instructor(s) on questionnaire submit | PR #926 | `2389449d` | shipped (2026-10-13) — verification HUC-98 in prod Phase-1 window |

**Scope source:** external review of merged PR #915 + PR #916 (`apps/platform`, `convex/`).
**Target branch:** `main` (each issue becomes its own PR; no combine unless noted).
**Apps affected:** `apps/platform`, `convex/`.
**Estimated scope:** 4 small/medium PRs. Originally stated as no schema changes, but HUC-95 deviates — see §4.2 (adds `notifiedInstructorAt: v.optional(v.number())` to the `onboardingQuestionnaireSubmissions` table). Files a Linear verification issue per AGENTS.md.

---

## 0. Context

PR 12 PR 4b (#915) shipped the questionnaire form + reminder cron + abandonment beacon on 2026-10-10. PR #916 (chore: reminder-scan P2 — index skip + reminderCount backfill) shipped on 2026-10-12 with the Greptile round-28 P2 resolved. The arc as a whole is closed (HUC-83, HUC-84 Done).

This document captures four issues identified against the merged code by an external review and verified against `origin/main` (`47486e1a`). Each issue is real, ranked by risk. None are blocking the merge (already merged), but each is worth its own PR.

### Out of scope (carried over from the original arc)

- 5-min-after-close reminder (plan §5.4 deferral). Still deferred.
- Bulk re-invite UI.
- Studio-side reskin.
- Edit-email / reassign path on the admin detail page (reviewer's minor #5). Real gap but a feature, not a bug — defer to a separate planning doc.

---

## 1. Webhook race — student sees 404 when `user.created` hasn't landed yet (highest priority)

### 1.1 Bug

A student signs up via Clerk. Clerk's `user.created` webhook fires asynchronously and calls `claimOnboardingByEmail` (already idempotent) to set `adminOnboardings.assignedStudentClerkId`. The student is then redirected to `/onboarding/[id]`.

If the student lands on the page **before** the webhook has been processed by Convex, `getOnboardingView` returns `null`. The reason is in `canViewOnboarding` at `convex/adminOnboarding.ts:1771` (paraphrased):

```ts
if (row.assignedStudentClerkId && row.assignedStudentClerkId === identitySubject) {
  return { role: "student" };
// 401-fallthrough for unassigned rows
```

When `assignedStudentClerkId` is `undefined` (webhook hasn't landed), the function returns `null` rather than a "you're a stranger" `403` — which is **correct** because we're trying not to leak row existence. But it confuses "stranger" with "legit student whose webhook is 3 seconds late." The student eats a bare 404 at the highest-intent moment.

### 1.2 Fix

In `app/onboarding/[id]/page.tsx` (or whatever reads `getOnboardingView`), when the view returns `null` and the caller is authenticated, inline-call `claimOnboardingByEmail` with the signed-in user's email. The mutation:

- Already exists (`convex/adminOnboarding.ts:claimOnboardingByEmail`)
- Is idempotent (a second call with the same args is a no-op)
- Uses `by_email` index — safe to call from a server component
- Will only match rows whose `email === identity.email`, so it cannot accidentally claim a row owned by someone else.

After the claim, re-query `getOnboardingView`. It now returns the assigned-student view.

### 1.3 Implementation notes

- The claim is an `internalMutation`. The page server component must call it via an HTTP action (existing pattern: see `convex/http.ts` for `claimOnboardingByEmail`'s wrapped HTTP route, or add a new one). Alternative: keep `claimOnboardingByEmail` as `internal` and add a public `claimOnboardingByEmailForCurrentUser` that reads `identity.email` from `ctx.auth`.
- Read the signed-in user's email from the Clerk auth session (via the `auth()` helper in the server component). **Do not** accept an email argument from the browser — the server component fills that in.
- The page already gates on authentication. The new behavior is: "if you're signed in but we can't see your onboarding row, try to claim it once before 404-ing."
- Add a 1-retry policy. If the claim returns `claimedOnboardingId: null`, do not retry — the user is genuinely a stranger. Render the existing not-found page.
- Add a small (e.g. 200ms) `await` between claim and re-query in dev to simulate the race; in production the claim is synchronous-via-HTTP.

### 1.4 Verification

- **Unit test (convex):** seed a `queued` `adminOnboardings` row with `email = "alice@example.com"`, `assignedStudentClerkId = undefined`. Call the new public `claimOnboardingByEmailForCurrentUser` as `alice@example.com`'s Clerk identity. Assert `claimedOnboardingId` matches the row and the row's `assignedStudentClerkId` flipped to the Clerk id. Re-call — assert idempotence.
- **Negative test:** Call as a different Clerk user (`bob@example.com`). Assert `claimedOnboardingId = null`. Assert the original row's `assignedStudentClerkId` is unchanged.
- **Stage test (manual) in a preview deployment:** simulate the race by blocking the `user.created` webhook handler (set `CONVEX_DEPLOY_KEY` to a non-prod deployment + disable the Clerk webhook URL). Sign up as a test student. Hit `/onboarding/[id]` directly — with the fix, the page should self-heal and render the assigned-student view. Without the fix, the page should 404.
- **Negative integration test:** non-existent onboarding id + signed-in user = 404 as before. The page server component must short-circuit on missing rows, not loop on claim.

### 1.5 Risks

- A malicious signed-in user could spam the claim endpoint. Mitigation: gate on authenticated Clerk identity; the mutation only matches `email === identity.email`; the mutation is idempotent so duplicates are no-ops.
- The claim matcher is email-based. If two rows have the same email (e.g. a re-invite created a duplicate before this arc), the claim uses the most-recent non-cancelled, non-terminal row (already behavior of the existing mutation). No regression.

### 1.6 Done when

- New Linear issue created and resolved.
- 590+ → 595+ convex tests still green.
- Manual race-repro above works on a preview deployment.
- Linear verification issue for prod.
- PR merged via standard Greptile round.

---

## 2. `force: true` beacon can clobber a fresher tab's edits

### 2.1 Bug

In round 27, we dropped the per-tab saveId namespace in favor of a single global monotonic counter (seeded from `stored + 1` on mount) — to avoid integer-overflow risk and the "two tabs with colliding saveId" class of bugs. The closing-tab (`navigator.sendBeacon`) path instead routes through `force: true`, which bypasses the strict-greater-than guard on the server (`convex/onboardingQuestionnaire.ts:saveQuestionnaireDraft`). Round-28 fix bumped the counter on forced overwrite to `max(stored + 1, clientSaveId)` so the counter never goes DOWN.

What round-28 didn't catch: the closing tab's beacon is allowed to undo a fresher tab's edits.

**Scenario (rare but real):**

1. Student opens Tab A. Counter seeds at 1. Types answers, autosaves at 9:00 (stored=1).
2. Student opens Tab B. Counter seeds from the current `stored + 1` = 2.
3. Tab A and Tab B both edit. Counter advances: 2, 3, 4…
4. **Tab B** makes its last edit at 9:25. Stored=10. Counter on closing tab would be 11+ next.
5. Student closes Tab A (which has been idle for 25 minutes). Tab A's beacon fires with the answers Tab A had EDITED-BY-9:00, with `force: true`. The server accepts the force-overwrite because `clientSaveId` is somewhere in [1..10] but with `force: true`, the strict check is bypassed.
6. Round-28 fix bumps stored to `max(stored+1, clientSaveId) = 11`. The newest answers in Tab B (saved at 9:25) are now rolled back to Tab A's stale snapshot. **Silent data loss.**

The right intent of `force: true` is "the closing tab's payload is the closing tab's CURRENT state". But a tab that has been idle for 25 minutes is NOT that.

### 2.2 Fix

Gate `force: true` accept on **payload recency**:

1. **Client**: the beacon side already has a snapshot of answers+inspirations captured at `pagehide` time. Add `payloadCapturedAt: number` to the beacon payload — set to the timestamp the snapshot was taken. (Easiest source: capture it alongside the existing snapshot ref.)
2. **Server**: in `saveQuestionnaireDraft`, when `args.force === true`, additionally require `args.payloadCapturedAt >= existing.updatedAt` to accept. If the beacon's captured snapshot is older than what's stored, return `accepted: false` and let the client (closing tab) tell the user their close-time save didn't take.
3. **Schema**: add `payloadCapturedAt: v.optional(v.number())` to the mutation args. Required when `force === true` (validated in handler with a clear error message).

This preserves the round-27 spirit (force exists to overcome the strict-greater-than guard for legitimate closing-tab race conditions) while bounding it: force only wins when the closing tab's local view is at least as current as the server's.

### 2.3 Implementation notes

- The captured-snapshot concept already exists in the form component as `submitSnapshotRef` (round-27 — captures answers+inspirations at submit click time before mutate). Mirror that pattern for the beacon.
- `payloadCapturedAt` is the timestamp the snapshot was captured in the closing tab. Wallclock in the tab's local time. Server compares to its own `updatedAt`. Skew tolerance: 0 — the tab's clock and Convex's clock are both wallclock; minor drift is acceptable for human-scale work.
- For the non-beacon (autosave PATCH) path, do NOT add `payloadCapturedAt`. The autosave path doesn't set `force`, so the strict-greater-than guard already keeps ordering correct.

### 2.4 Verification

- **Unit test (convex):** seed a row with `updatedAt = 1000`. Call `saveQuestionnaireDraft` with `force: true` and `payloadCapturedAt = 999` (snapshot older than row). Assert `accepted = false` and the row's `answers` are unchanged.
- **Unit test (convex):** seed with `updatedAt = 1000`. Call `saveQuestionnaireDraft` with `force: true`, `payloadCapturedAt = 1000` (snapshot equal). Assert `accepted = true` (equal is acceptable — the closing tab has caught up but can't beat the stored value).
- **Unit test (convex):** seed with `updatedAt = 1000`. Call with `force: true`, `payloadCapturedAt = 1100` (snapshot newer). Assert `accepted = true` and `storedClientSaveId` increments.
- **Unit test (convex):** call with `force = undefined` (normal autosave) and `payloadCapturedAt = 50` (way old). Assert `accepted = false` — payloadCapturedAt only matters when force is true.

### 2.5 Risks

- Adds one more field to the beacon payload. Negligible.
- If the closing tab's clock is far in the past (browser clock skew), `payloadCapturedAt` will be too low and the close-time save will be rejected. Acceptable: the student will see the unsaved indicator (or implicit via `accepted: false` flag in the response) and can re-open the tab to retry. Better than silent data loss.

### 2.6 Done when

- New Linear issue created and resolved.
- 595+ → 598+ convex tests still green.
- Round-trip walkthrough on a preview deployment: two tabs, edits in both, close one, verify the fresher tab's data survives.

---

## 3. `/api/onboarding/*` route layer has zero tests

### 3.1 Bug

PR #915 shipped 7 Next.js API routes that wrap Convex mutations/actions:

- `/api/onboarding/[id]/questionnaire` (GET/PATCH)
- `/api/onboarding/[id]/questionnaire/submit` (POST)
- `/api/onboarding/[id]/work-examples` (POST)
- `/api/onboarding/[id]/work-examples/upload-url` (POST)
- `/api/onboarding/[id]/work-examples/[exampleId]` (DELETE)
- `/api/onboarding/[id]/work-examples/[exampleId]/download-url` (GET)
- `/api/onboarding/[id]/abandoned` (POST)

**None of them has a `route.test.ts`.** Greptile's history on this PR was nearly all P1 fixes on the Zod↔Convex-validator seam — arg-mismatch errors, missing fields, wrong types — and those fixes shipped in isolation without any test that would have caught them earlier.

The rest of `apps/platform/app/api/**` does have `route.test.ts` per route (12+ test files in the tree). The onboarding routes are a gap.

### 3.2 Fix

Two-pronged approach:

1. **Add `route.test.ts` per route** mirroring the patterns of existing tests (`apps/platform/app/api/sessions/[sessionId]/reschedule/route.test.ts` is a good neighbor). For each route:
   - Happy path: signed-in assigned student calls with valid args. Asserts the call propagates to the matching Convex mutation with the right arg shape.
   - Auth rejection: unauthenticated request → 401.
   - Wrong identity: signed-in but not the assigned student → 403.
   - Zod parse failure: missing required field, invalid type → 400.
   - Convex-validator mismatch simulation: a Zod-valid payload that the Convex mutation rejects → 500 with the underlying error message.
2. **Add a conformance script** (`scripts/convex-route-conformance.ts` or similar) that diffs every Zod schema in the route layer against the Convex validator in the matched mutation. The script verifies field name + type + optional/required matches. Running this in CI catches drift before tests even need to.

Or, if we want to remove the duplicated schema entirely: generate the Zod schemas from the Convex validators and have the routes import the generated schema. Larger change; defer unless the duplication bites us again.

### 3.3 Implementation notes

- The neighbor test files use `next-test-api-route-handler` or similar to drive the Next handler. Audit which test setup is in use in `apps/platform/app/api/*` and copy the imports / fixtures.
- The tests should mock the Convex client OR run against a real Convex dev deployment. Mocking is faster; real-dep is more faithful. Pick mock unless we already have a fixture pattern. Document the choice.
- For #3.2.2, the conformance script should run as a `pnpm run check:convex-route-conformance` and fail the build on drift.
- Trigger.dev-style task: each new test file is mechanical. Group as a single PR.

### 3.4 Verification

- 7 new test files land with the PR.
- CI runs them on every PR touching `apps/platform/app/api/onboarding/**`.
- The conformance script (if shipped) reports 0 drift on the initial run.
- Round-trip run on `pnpm run test:apps` (the apps-side test runner).

### 3.5 Done when

- New Linear issue created and resolved.
- 0 → 7 `route.test.ts` files in `apps/platform/app/api/onboarding/**`.
- All CI checks still green.

---

## 4. No instructor notification on questionnaire submit

### 4.1 Bug

When the student successfully submits the questionnaire, `submitQuestionnaire` writes the row (`status = "submitted"`, `submittedAt = Date.now()`) and returns. **No signal is emitted.** The instructor has no way to learn a new submission is awaiting review except by manually refreshing their instructor dashboard.

This is a UX gap that touches the core product value: the questionnaire exists so instructors can review the student's background and goals before the first call. With no outbound signal, a submitted questionnaire can sit unread for days.

### 4.2 Fix

After the row is set to `submitted`, fire an Inngest event. The Inngest consumer routes to a Resend-powered email to **each** assigned instructor (`row.perInstructor`). The email contains:

- Student name (from `users` table, by `studentClerkId`)
- Submitted-at timestamp
- Deep link to the instructor view: `/instructor/onboarding/[onboardingId]` (already exists from PR #915)

Idempotence: store `notifiedInstructorAt: v.optional(v.number())` on the submission row. Read this in the event handler and short-circuit if already set. The original `submitQuestionnaire` writes `notifiedInstructorAt = now` so re-submissions (which the mutation already treats as idempotent) don't double-send.

### 4.3 Implementation notes

- New Inngest event: `questionnaire/submitted` with payload `{ submissionId, onboardingId, studentClerkId }`.
- New Inngest consumer function: `notifyInstructorsOnSubmission` in `apps/platform/inngest/functions/onboarding-questionnaire-submitted-notification.ts` (or whatever). Reads the submission, fetches instructors via the parent `adminOnboardings.perInstructor`, fetches their emails from the `instructors` table, renders a Resend template, sends.
- Email template: new file `apps/platform/lib/emails/questionnaire-submitted-to-instructor.ts`.
- One Resend batch per onboarding (which can have multiple instructors). Subject: "[Huckleberry] New mentor intro from {studentName}".
- Why Inngest and not just a `ctx.scheduler.runAfter` Convex action? Convex actions can run async, but Inngest gives us Retries + Dead Letter + observability out of the box, and we already use Inngest elsewhere in the app (`apps/platform/inngest/functions/checkStaleOnboardingDrafts.ts`). Consistency wins.
- Update the `submitQuestionnaire` mutation to write `notifiedInstructorAt` and emit the event. Don't try to send the email inline — keep the mutation tight; let the Inngest consumer do the work.

### 4.4 Verification

- **Unit test (convex):** seed a submitted row with `notifiedInstructorAt = undefined`. Call the new internal action / Inngest handler. Assert emails go out to each assigned instructor. Assert `notifiedInstructorAt` is now set.
- **Unit test (convex):** call again. Assert emails are NOT re-sent (idempotence).
- **Integration test (Inngest mock):** when `submitQuestionnaire` is called, mock the Inngest event emitter; assert `questionnaire/submitted` is emitted with the right payload.
- **Manual:** sign in as a test student, submit the questionnaire. Verify the assigned instructor's email arrives within 1 minute (Inngest cold start ≤ 30s typical).

### 4.5 Risks

- Instructors with `notification preferences = off` for emails. Currently we don't have an in-app preference for "instructor-onboardings" emails; defer that to a follow-up. All instructors receive the email by default.
- Multi-instructor listings. Emailing N instructors is fine; Resend batch endpoint handles this.
- Email deliverability — confirm the SPF/DKIM/DMARC setup works for the onboading-submission-from-name before this PR ships (mirror the booking-email setup).

### 4.6 Done when

- New Linear issue created and resolved.
- The student dashboard's "X days since submitted" indicator (already shown on `/onboarding/[id]`) flips to "instructor notified ✓" once the email send completes — verify on a preview deployment.
- Resend dashboard shows the email under the "instructor-onboarding-submitted" template.

---

## 5. Recommended execution order

1. **#1** (webhook race) — small, high-impact, isolated to one server component + one helper. ~half day including tests. ✓ **Shipped** (PR #923, 2026-10-13; verification in progress via HUC-96).
2. **#3** (route tests) — mechanical, mostly copy-paste from neighbors. ~1 day. Could be done first to give us the test scaffolding that #2 and #4 will benefit from. ✓ **Shipped** (PR #924, 2026-10-13).
3. **#2** (force:true recency gate) — small mutation change + client-sided payload addition. ~half day. ✓ **Shipped** (PR #925, 2026-10-13; verification in progress via HUC-97).
4. **#4** (instructor notification) — Inngest + Resend + idempotency bookkeeping. ~1 day. Longest PR. **Not started.** Lives in `apps/platform/inngest/functions/` and `convex/onboardingQuestionnaire.ts:submitQuestionnaire`; needs `notifiedInstructorAt` schema field (deviates from the no-schema-change statement in this doc's header — properly noted).

Total: ~3 working days, all sequential, no combine.

---

## 6. Quality bar (carry-overs from the original arc)

- "Never use `mentor` / `mentee` in code; `instructor` / `student`. The word `mentorships` stays in UI copy." (AGENTS.md.)
- Convex is the source of truth for instructor and student onboarding data. Do not introduce Supabase/Postgres reads for either of these.
- `withIndex` not `.filter` for indexed queries. `v.literal` for exact strings.
- One `.paginate()` per query handler. Cursor returned; caller loops.
- Internal Convex calls go through `(internal as any).module.fn` patterns or the typed `internal` exports — not via re-exported `api`.
- Greptile workflow: `npx greptile@latest review -b origin/main` from inside the worktree.
- At least one bot APPROVED before merge (CodeRabbit skipped for low-star repos).
- Linear verification issue per PR that touches `convex/schema.ts`, auth gates, public Convex queries consumed by more than one app, Trigger.dev/Inngest tasks, or CI workflows. None of these PRs touch schema, but #4 touches an Inngest task — file a verification issue.
- Secret protection: never paste real keys into PR descriptions or commit messages. Use `<COPY_FROM_APP_X>` placeholders.
- Widen-migrate-narrow for any schema changes. None here.

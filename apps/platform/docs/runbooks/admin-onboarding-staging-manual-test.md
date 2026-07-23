# R9 — End-to-end manual verification of the Kajabi admin-onboarding flow in staging

**When to use this runbook**: before any release that touches the admin-onboarding form, the `adminOnboardingFlow` Inngest handler, or the per-recipient idempotency tracking. Also use when triaging a customer report that an admin-onboarding submission did not produce the expected student email / instructor email / admin summary / Discord DM.

This runbook exercises **only the admin-onboarding path** — `adminOnboardingFlow` triggered by `admin/onboarding.completed`. The Stripe / PayPal purchase flow (`onboardingFlow` triggered by `purchase/instructor`) has its own manual-test checklist in [`TESTING_CHECKOUT.md`](../../../../TESTING_CHECKOUT.md) and [`STRIPE_TESTING_CHECKLIST.md`](../../../../STRIPE_TESTING_CHECKLIST.md) at the repo root.

## Prerequisites

Staging environment must have:

- `NEXT_PUBLIC_APP_URL` set to the staging URL (used in admin summary email links).
- `CONVEX_HTTP_KEY` set (Inngest workers and Next.js API routes authenticate server-to-server Convex calls with this bearer; see [`convex/http.ts`](../../../../convex/http.ts)).
- `RESEND_API_KEY` and `EMAIL_FROM` set to a Resend staging API key (sends go to a `*.resend.dev` sandbox or to a verified test domain — never production recipients).
- `EMAIL_USE_TEMPLATES` and the three `RESEND_TEMPLATE_ID_*` env vars if you want the template path; otherwise the `buildAdminPurchaseEmail` fallback renders a fully-formed HTML email.
- `ADMIN_EMAILS` set to at least one staging admin mailbox (you control).
- `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set to the staging Clerk instance.
- A Discord staging webhook if you want to verify DM enqueue (optional — the Inngest flow just enqueues, no send).
- `npx inngest dev` running locally against the staging Convex deployment if you want to inspect run state.

Reset the staging database to a known-empty state before starting: `npx convex run adminOnboarding:resetStagingData '{}'` (this internal mutation is **not shipped yet** — track as follow-up if you need it; otherwise manually delete the test rows after each scenario).

## Scenario 1 — New student, single instructor (happy path)

**Goal**: verify the canonical new-pair path produces exactly the expected artifacts and the right emails land.

1. From the admin dashboard at `/admin/students/invite`, switch the mode toggle to "Full onboarding (with workspace assignment)".
2. Enter `student-1@example.com` (use a disposable inbox that you control — Mailtrap or similar).
3. Select 1 instructor who has at least 4 sessions of capacity (any instructor below the cap).
4. Click "Preview". Verify:
   - The preview panel shows: 1 student email, 1 instructor email, 1 admin email.
   - The preview row says "New workspace" (not "Renewal").
   - Capacity badge is below the cap (no override-reason field shown).
5. Click "Confirm and Send". Verify:
   - The success panel shows a link to `/admin/onboardings/<onboardingId>`.
   - The onboarding row has `status: processing`.
6. Within 60 seconds (Inngest run latency), verify:
   - **Student inbox**: 1 email from the staging Resend key with subject "Welcome — your session pack with <instructorName> is ready" (or HTML fallback subject). Body lists the instructor and the workspace link.
   - **Instructor inbox**: 1 email with subject "New student assigned — student-1@example.com" (or fallback). Body includes the student's email, sessions count, expiration, workspace link.
   - **Admin inbox**: 1 email with subject "Kajabi onboarding — student-1@example.com × 1 instructor" (or fallback). Body renders the full per-instructor table.
   - **Convex dashboard**: `adminOnboardings` row has `status: completed`, `emailsSent: { student: true, instructors: [<id>], adminSummaryByEmail: { admin@huckleberry.art: true } }`, and 6 timeline entries (`queued`, `processing_started`, `email_sent × 3`, `discord_queued`, `completed`).
   - **Workspaces table**: 1 new workspace named `student-1@example.com × <instructorName>`, owned by `email:student-1@example.com` (placeholder until Clerk sign-up).
   - **Discord action queue**: 1 row with `kind: "dm_instructor_new_signup"`, `subjectUserId: "email:student-1@example.com"`.
7. Verify Clerk invitation: from the Clerk dashboard, search for `student-1@example.com`. There should be exactly 1 pending invitation with the redirect URL pointing at `<staging>/sign-up`.

If any of step 6 fails: see "Failure modes" below.

## Scenario 2 — New student, multiple instructors (fan-out)

**Goal**: verify the per-instructor email fan-out produces N instructor emails (not 1 aggregate).

1. As above, but select 3 instructors, each with capacity.
2. Click "Preview". Verify preview says "3 instructor emails".
3. Click "Confirm and Send".
4. Verify:
   - **3 instructor inboxes**: each instructor receives exactly 1 email (no duplicates, no aggregates).
   - **Student inbox**: 1 email listing all 3 instructors and 3 workspace links.
   - **Admin inbox**: 1 email with a 3-row table (one row per instructor).
   - **Workspaces table**: 3 new workspaces, one per instructor, each named `<studentEmail> × <instructorName>`.
   - **Discord action queue**: 3 rows.
   - **`emailsSent.instructors`**: array of 3 instructor IDs.

## Scenario 3 — Returning student (renewal path)

**Goal**: verify the renewal detection in `detectRenewal` correctly reuses the existing seat + workspace and produces renewal copy.

Prereq: scenario 1 must have completed for `student-1@example.com` and a Clerk sign-up must have happened (so `linkClerkUserToSessionPacks` rewrote `sessionPacks.userId` from `email:student-1@example.com` to the Clerk `userId`).

1. From a NEW admin-onboarding form submission, use the same `student-1@example.com` and the SAME instructor as scenario 1.
2. Click "Preview". Verify preview row says "Renewal — existing workspace".
3. Click "Confirm and Send".
4. Verify:
   - **No new workspace created** (workspaces table is unchanged).
   - **No new session pack** (sessionPacks query by `(userId, instructorId)` returns 1 row, not 2).
   - **No new seat reservation**.
   - **Instructor email subject** says "Renewal — student-1@example.com" (not "New student assigned").
   - **Student email subject** says "Welcome back — your session pack with <instructorName> is ready".
   - **`isRenewalAllPairs`**: true.

## Scenario 4 — Mixed (1 new + 1 renewal)

**Goal**: verify per-pair semantics hold — some pairs renew, others don't, and the summary email shows both flags independently.

1. From a new submission, use `student-1@example.com` (already signed up via Clerk from scenario 3) with TWO instructors: the one from scenario 1 (renewal) AND a fresh one (new).
2. Click "Preview". Verify one row says "Renewal — existing workspace", the other says "New workspace".
3. Click "Confirm and Send".
4. Verify:
   - Exactly 1 new workspace, 1 reused workspace.
   - Instructor email subjects differ per pair (one says "Renewal", the other "New student assigned").
   - Student email subject says "Welcome" (NOT "Welcome back") because `isRenewalAllPairs` is false.
   - Admin summary table shows one row with `isRenewal: true`, one with `isRenewal: false`.

## Scenario 5 — Capacity override

**Goal**: verify the override-reason field is required when an instructor is at cap, and that the override is recorded on the row.

1. Pick an instructor who is at or near their `maxActiveStudents` cap. Use the admin dashboard to manually bump an existing student to that instructor's pair (or use the database directly).
2. Submit an admin-onboarding for a new student selecting the at-cap instructor.
3. Verify the "Reason for capacity override" field appears in the form and is required.
4. Try to submit without a reason — verify the form blocks submit and shows an error.
5. Submit with a reason like "test-override-r9".
6. After completion, verify `adminOnboardings.capacityOverrideReason === "test-override-r9"` on the row, and that a `workspaceAuditLogs` entry exists with `details` containing the override reason.

## Scenario 6 — Advanced split toggle

**Goal**: verify the separate-student-record path creates a new Convex `users` row with an `onboardingAlias` marker.

1. Use a new student email (not used before) and 1 instructor.
2. Check the "Create a separate student record for this email (Convex-only split, does not create a new Clerk account)" disclosure.
3. Verify the confirmation modal explains exactly what happens and asks for an admin note.
4. Enter a note like "test-split-r9".
5. Submit.
6. Verify:
   - **`users` table**: a new row for the email with `onboardingAlias: <uuid>` AND the original `users.email` row (if any) is untouched.
   - **`adminOnboardings.onboardingAlias`** equals the same `<uuid>`.
   - **Clerk dashboard**: still only 1 invitation for the email (Clerk remains a single account).
   - **`capacityOverrideReason` or `notes`**: contains "test-split-r9".

## Scenario 7 — Stale digest (manual trigger)

**Goal**: verify the daily 09:00 UTC stale-digest flow works end-to-end and that the seat release does not break active seats.

1. Create a synthetic admin-onboarding in `completed` status with `createdAt = now - 14 days` and a placeholder session pack with `userId = "email:test-stale@example.com"` (no Clerk sign-up).
2. From the Inngest dashboard, find the `admin-onboarding-stale-digest-flow` scheduled function. Click "Invoke" (or send the `admin/onboarding.stale-digest` event manually).
3. Verify:
   - **Admin inbox**: 1 batched digest email listing the stale invite with days pending + suggested action.
   - **`seatReservations`**: matching placeholder row flipped to `released` (PR 4 only releases seats whose `userId` still starts with `email:` — those rewritten to a real Clerk ID are skipped).
   - **`workspaces`**: matching workspace's `endedAt` set to now (only for workspaces whose `ownerId` still starts with `email:`; reused renewal workspaces are NOT touched because their `workspaceId` is undefined on the onboarding row).
   - **`sessionPacks`**: matching placeholder pack flipped to `expired` (NOT `cancelled` — the schema has no cancelled status; only active packs are touched).
   - **`studentInvitations`**: NOT touched by the digest. The digest does not update the `studentInvitations` table; that table is updated by the invitation-creation and acceptance flows, not by the stale-cleanup path. Do not assert on it for this scenario.
   - **`adminOnboardings.status`**: stays `completed`. The schema does not have a `released` status — release is a sub-event of `completed`, recorded only in the timeline.
   - **`adminOnboardings.timeline`**: appends a `released` entry with `details` of the form `"stale-invite-digest auto-release: placeholder held > 13 days | seats=<N>,workspaces=<N>,packs=<N>,skipped=<N>"`. The trailing `seats/workspaces/packs/skipped` counters come from `releasePlaceholderInventoryInternal` (`convex/adminOnboarding.ts:1184-1282`) — `skipped` counts placeholders that were already released or that have been claimed by a real Clerk user.
   - **`adminOnboardings.releasedAt`**: NOT set. The PR 4 plan referenced a `releasedAt` field on the row, but it was never added to the schema — release observability lives in the timeline only.

Repeat with `createdAt = now - 1 day` to verify the 13-day cutoff correctly **excludes** recent completed onboardings (`isStaleOnboardingRow` requires `row.createdAt >= cutoffMs` where `cutoffMs = now - 13 days`, so recent rows pass the `>=` check and are not returned).

## Scenario 8 — Failure mode: malformed event

**Goal**: verify the `NonRetriableError` path on malformed event payloads does not retry forever.

1. From the Inngest dashboard, manually send an `admin/onboarding.completed` event with `data: { onboardingId: "not-a-real-id" }`.
2. Verify the run fails immediately (no retries) with the `NonRetriableError` log line.

## Failure modes

| Symptom | Where to look |
|---|---|
| No student email | `Inngest dashboard → adminOnboardingFlow → run timeline`. Check `send-student-email` step output. Look for `RESEND_API_KEY` missing or `Convex query for getAdminOnboardingAction` failing. |
| Student email sent but instructor emails skipped | `emailsSent.instructors` array on the row — if populated, the send happened. Check `send-instructor-emails` step output for the per-iteration Resend response. |
| All admin emails re-sent after a deploy | Read [`admin-onboarding-legacy-admin-summary-rows.md`](./admin-onboarding-legacy-admin-summary-rows.md) — this is R8 in action. |
| Resend 429 rate-limit responses | PR 12 throttle (1s/iteration) + PR 9 cap (5 concurrent) should keep this inside the paid-tier limit. If you see 429s, drop `ADMIN_EMAILS` to 1 or wait for the burst to drain. |
| Discord DM not delivered | The Inngest flow only **enqueues** (`migrateDiscordAction`); it does not send. Check the `discordActionQueue` table for the enqueued row. The Discord bot polls the queue. |
| Clerk invitation duplicate error | Scenario 1 + scenario 3 for the same email should produce exactly 1 invitation. If you see a 409 from Clerk, the renewal path is mis-detecting — re-run scenario 3 with a fresh student. |
| Stale digest misses a known-stale row | Check the 13-day cutoff logic in `isStaleOnboardingRow` (`apps/platform/lib/admin-onboarding/stale-onboarding-filter.ts`). The helper requires `row.createdAt >= cutoffMs` (note the `>=` direction — older rows pass). |
| Per-row Retry button doesn't appear | Read [`apps/platform/components/admin/retry-onboarding-button.tsx`](../../components/admin/retry-onboarding-button.tsx) — the button hides for non-failed/non-queued statuses. |

## Cleanup after each scenario

1. From the Convex dashboard, hard-delete the test row: `npx convex run adminOnboarding:hardDelete '{"id": "<onboardingId>"}'` (mutation **not shipped**; tracked as follow-up — manually delete via dashboard "Data" tab in the meantime).
2. Cancel any pending Clerk invitations from the Clerk dashboard.
3. Manually delete the test session pack + seat + workspace from the "Data" tab if scenario 1 or 2 created real artifacts.
4. If you triggered the stale digest, manually re-activate the released seat (`status: "active"`) and clear `workspaces.endedAt` so subsequent scenarios have a clean slate.

## Related code references

- `apps/platform/inngest/functions/onboarding.ts` — the `adminOnboardingFlow` handler.
- `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts` — the daily stale-digest cron + manual-trigger flow.
- `convex/adminOnboarding.ts` — mutations, queries, helpers (`detectRenewal`, `releasePlaceholderInventoryInternal`, `appendTimelineEntry`).
- `apps/platform/components/admin/admin-onboarding-form.tsx` — the two-phase form component.
- `apps/platform/lib/admin-onboarding/stale-onboarding-filter.ts` — pure helper for the stale-digest row filter.
- `apps/platform/lib/admin-onboarding/emails-sent-merge.ts` — pure helper for `appendTimelineEntry` merge semantics.
- `apps/platform/lib/admin-onboarding.ts:7-13` — `ALLOWED_TRANSITIONS` state machine (source of truth for the state machine referenced in the R8 runbook).

# Onboarding follow-up reminders

The hourly `onboarding-follow-ups` Inngest function (at minute 15) sends four
nudges. It also accepts the `onboarding/followups.run` event for a manual run.

| Nudge | When | Who | Condition |
| --- | --- | --- | --- |
| Invite reminder | 48h after onboarding | Student | No linked Clerk account (`assignedStudentClerkId` empty) |
| Final invite reminder | 5 days after onboarding | Student | Still no account |
| Admin check-in | 7 days after onboarding | `ADMIN_EMAILS` | Still no account; one digest for the batch |
| Instructor review nudge | 3 days after questionnaire submission | Assigned instructor | No `reviews` entry yet |

**Automatic:** the two student invites. They are time-sensitive and the student
has no account yet, so holding them for review would cost days. Every automatic
send is reported in a summary digest to `ADMIN_EMAILS` (see below).

**Gated:** the instructor review nudge and the 7-day admin check-in. Those wait
in the outbox for approval.

## What already existed

- Questionnaire reminders at 24h / 48h / 96h after the student's last
  questionnaire activity (max 3), while the draft is unsubmitted.
- The 13-day stale-invite digest to admins, which also releases the
  placeholder seat.

The new reminders do not overlap with those: invite reminders only target
students with no account, and the review nudge targets instructors after a
submission.

## Review before sending (outbox)

The gated kinds leave nothing to chance: each run stages what it would send in
the reminder outbox, and the row is `pending_review` until someone acts on it.

- **Admin surface:** `/admin/onboarding-reminders` (nav: *Reminder outbox*).
  Tabs: *Pending review*, *Approved*, *Sent*, *Not sending*.
- **Approve** → the row is `approved` and the worker sends it on the next run
  (an `onboarding/followups.send` event fires immediately, so it is usually
  under a minute). The send is idempotent on the dedupe key.
- **Not sending** → requires a reason; the row is `suppressed`. The dedupe key
  is kept, so the hourly scan will not queue that nudge again. This is the
  "do not send" record the next person reads.
- Every approve/suppress writes an `auditLogs` row
  (`approve_onboarding_reminder` / `suppress_onboarding_reminder`).

## Automatic send digest

When a run delivers student invites, the worker builds one summary email for
`ADMIN_EMAILS`:

- Subject: `Reminders sent automatically — N student email(s)`.
- Body: a per-kind breakdown plus a table of student, email, and onboarding
  link.
- Sent once per run, idempotent on a hash of the delivered
  `(onboardingId, kind)` pairs, so an Inngest retry cannot double-send it.
- A total delivery failure throws, which retries the step; individual admin
  failures just reduce the recipient count.

The digest is the notification for the only email that leaves without an
approval. Automatic sends also appear in the outbox's *Sent* tab.

### Send-time re-check

The queue can sit for days, so the worker re-checks each row when it claims it
(`onboardingReminderReview.claim`). A nudge whose reason no longer holds is
auto-suppressed with the reason instead of being sent:

- the student signed up (invite / admin digest),
- the pair has used a session,
- the instructor already reviewed the submission,
- the instructor is no longer assigned, or cannot open the link,
- the onboarding was cancelled.

Claiming also marks the row `sending`, so two overlapping runs cannot both send
it. A crashed run is re-claimed after 10 minutes. A late "not sending" on a
claim already in flight is refused.

### One-off backfill after the outbox deploy

Rows written before the outbox have no `status`, so the *Sent* tab cannot list
them. Run this once against the deployment:

```bash
npx convex run onboardingReminderReview:backfillLegacyStatus
```

### Why a nudge is skipped before it is even staged

Queuing a nudge the admin would immediately suppress wastes a review slot, so
the scan applies two guards first:

- **The instructor must be able to open the review link.** The link is
  `/onboarding/<id>`, and the auth gate only admits the Clerk user stored on the
  instructor row. A row with no linked account, or whose account email differs
  from the recipient address, is skipped rather than mailed a dead link.
- **The pair must not have met yet.** If the student has already used a session
  from the pack that onboarding created, the questionnaire review is no longer
  what is blocking them; no nudge is staged.

## Dedupe and safety

- `onboardingReminders` stores one row per `dedupeKey`; the scan excludes
  anything already recorded — pending, approved, sent, **or suppressed**.
- Student and instructor sends use the `dedupeKey` as the Resend idempotency
  key, covering the gap between a successful send and the mark call.
- The admin digest is one email per batch; every row in the batch is marked
  after at least one recipient accepts it.
- A cron replay or overlapping run cannot double-send.

## Links

- Student: `<APP_URL>/sign-up` and `<APP_URL>`.
- Instructor: `<APP_URL>/onboarding/<onboardingId>` — `/onboarding/:path*` is in
  `PROTECTED_ROUTE_PATTERNS`, so a signed-out click goes to `/sign-in` with a
  `redirect_url` back instead of rendering a bare 404.
- Admin: `<APP_URL>/admin/onboardings/<onboardingId>`.

## Manual run

Send `onboarding/followups.run` through Inngest, or use the Inngest dashboard's
Test page. The function is idempotent: a run stages candidates and sends whatever
an admin has already approved. `onboarding/followups.send` does the same and is
fired automatically when an approval lands.

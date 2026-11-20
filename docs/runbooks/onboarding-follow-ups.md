# Onboarding follow-up reminders

The hourly `onboarding-follow-ups` Inngest function (at minute 15) sends four
nudges. It also accepts the `onboarding/followups.run` event for a manual run.

| Nudge | When | Who | Condition |
| --- | --- | --- | --- |
| Invite reminder | 48h after onboarding | Student | No linked Clerk account (`assignedStudentClerkId` empty) |
| Final invite reminder | 5 days after onboarding | Student | Still no account |
| Admin check-in | 7 days after onboarding | `ADMIN_EMAILS` | Still no account; one digest for the batch |
| Instructor review nudge | 3 days after questionnaire submission | Assigned instructor | No `reviews` entry yet |

## What already existed

- Questionnaire reminders at 24h / 48h / 96h after the student's last
  questionnaire activity (max 3), while the draft is unsubmitted.
- The 13-day stale-invite digest to admins, which also releases the
  placeholder seat.

The new reminders do not overlap with those: invite reminders only target
students with no account, and the review nudge targets instructors after a
submission.

## Review before sending (outbox)

Nothing leaves without an admin decision. Each run of the worker stages what it
would send in the reminder outbox; the row is `pending_review` until someone
acts on it.

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

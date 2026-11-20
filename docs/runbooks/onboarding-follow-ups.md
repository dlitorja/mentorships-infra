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

## Dedupe and safety

- `onboardingReminders` stores one row per `dedupeKey`; the scan excludes
  anything already marked.
- Student and instructor sends use the `dedupeKey` as the Resend idempotency
  key, covering the gap between a successful send and the mark call.
- The admin digest is sent once per batch; all rows in the batch are marked
  after at least one recipient accepts it.
- A cron replay or overlapping run cannot double-send.

## Links

- Student: `<APP_URL>/sign-up` and `<APP_URL>`.
- Instructor: `<APP_URL>/onboarding/<onboardingId>`.
- Admin: `<APP_URL>/admin/onboardings/<onboardingId>`.

## Manual run

Send `onboarding/followups.run` through Inngest, or use the Inngest dashboard's
Test page. The function is idempotent.

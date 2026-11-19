# Email-first Kajabi onboarding runbook

> Runbook for onboarding a student who purchased through Kajabi. The
> **default path is automated**: the Kajabi webhook commits the enrollment and
> the existing admin-onboarding flow sends the emails. The manual steps below
> are the fallback when the webhook cannot be used (e.g. a purchase that
> predates the offer mapping, or a backfill).
>
> Discord is not part of onboarding. The bot and action queue remain available
> for the community server, but onboarding never enqueues DMs or role
> assignments.
>
> Status: automated path shipped in the Kajabi auto-onboarding PR. Update this
> runbook after the first webhook-driven production purchase with anything that
> differed.

## Goals

1. Replace Discord introductions with email. The instructor, the student, and
   both admin mailboxes are notified by email, and every send is recorded on
   the `adminOnboardings` row.
2. Keep the same Convex artifacts the admin UI would create (session pack, seat
   reservation, workspace, audit log, onboarding record) so the admin UI,
   recovery dashboard, questionnaire, and reminders all keep working.
3. Make the process repeatable enough to automate later (see "Follow-ups").

## Non-goals

- Building a new admin form or changing the admin UI.
- Changing Clerk configuration or instance settings.
- Discord DMs for onboarding. Discord remains a community channel only.

## Automated path (default)

1. Kajabi sends the purchase webhook to `apps/marketing`.
2. The webhook applies the inventory change and, for a mapped one-on-one
   offer with a member email, POSTs `/admin-onboarding/kajabi-purchase` on
   Convex (bearer `CONVEX_HTTP_KEY`).
3. Convex resolves the instructor by slug, commits the session pack, seat, and
   workspace, and emits `admin/onboarding.completed`.
4. `adminOnboardingFlow` sends the student, instructor, and admin emails and
   marks the row completed. No Clerk invitation is created: sign-up is public,
   and the student email links to `/sign-up`.

Requirements:

- A `kajabiOfferMappings` row for the offer. Without it the webhook returns
  404 and nothing is onboarded. Seed it with
  `npx convex run digest:internalBulkImportKajabiOfferMappings`.
- The instructor's `instructors` row must be active.
- `INNGEST_EVENT_KEY` must be set on the Convex deployment; the commit endpoint
  uses it to emit the flow event.

The manual steps below are the fallback for purchases that cannot go through
the webhook.

## Recipients and responsibilities

| Recipient | Address | Purpose |
| --- | --- | --- |
| Student | the purchaser's email from Kajabi | Account invitation, sign-in link, questionnaire, support contact |
| Instructor | the instructor's address on their Convex `instructors` row | New student details and the 48-hour reach-out expectation |
| Admins | `ADMIN_EMAILS` (see below) | Record of the enrollment, product, and delivery receipts |

Outbound mail uses:

- **From:** `Huckleberry Mentorships <noreply@huckleberry.art>`
- **Reply-To:** `support@huckleberry.art`

Replies to `support@huckleberry.art` are forwarded to the admin mailboxes (see
"Admin notification routing").

## Pre-flight (read-only)

Confirm all of the following before creating anything.

1. **Instructor row is active and matches the Clerk user.**
   `npx convex data instructors --limit 200` — check `email`, `userId`,
   `isActive`, `maxActiveStudents`, `oneOnOneInventory`.
2. **No existing student account or pending invitation.**
   - Convex: no `users` row for the student email.
   - Clerk production instance: no user and no pending invitation.
3. **No renewal conflict.** Run the preview query with an admin identity:

   ```bash
   npx convex run adminOnboarding:previewAdminOnboarding \
     '{"email":"<STUDENT_EMAIL>","instructors":[{"instructorId":"<INSTRUCTOR_ID>","sessionsPerInstructor":<N>}]}' \
     --identity '{"subject":"<ADMIN_CLERK_ID>","email":"<ADMIN_EMAIL>","name":"<ADMIN_NAME>","role":"admin"}' \
     --codegen disable
   ```

   Expect `action: "new_workspace"`, `existingStudent: null`, and an empty
   `warnings` array. A populated `warnings` array is a stop-and-review signal.

4. **Kajabi offer is known.** Record the offer id and public link. If the offer
   is not in `kajabiOfferMappings`, note it — the webhook will not auto-onboard
   future buyers of that offer (see "Follow-ups").

## Step 1 — Create the Clerk invitation

Create the invitation against the **production** Clerk instance with student
metadata. Suppress Clerk's own invitation email so the branded email in Step 3
is the only one the student receives.

- Endpoint: `POST https://api.clerk.com/v1/invitations`
- Body:
  - `email_address`: the student email
  - `redirect_url`: `<APP_URL>/sign-up` (`https://dev.mentorships.huckleberry.art/sign-up`)
  - `public_metadata`: `{ "role": "student", "isStudent": true }`
  - `notify`: `false`
- Auth: `CLERK_SECRET_KEY` from `apps/platform/.env.local`, read inside the
  process. Never print the key or paste it into a transcript, PR, or doc.

Record the returned `id` (`inv_…`) and `url` (the unique acceptance link).
The link is single-use per email and must not be committed or shared outside
the student email.

## Step 2 — Commit the enrollment

Run the same mutation the admin UI calls. It creates the `adminOnboardings`
row, session pack, seat reservation, workspace, and audit log, then sets the
row to `processing`.

```bash
npx convex run adminOnboarding:adminOnboardStudent \
  '{
    "email":"<STUDENT_EMAIL>",
    "instructors":[{"instructorId":"<INSTRUCTOR_ID>","sessionsPerInstructor":<N>,"expiresAt":<MS_EPOCH>}],
    "source":"kajabi",
    "clerkInvitationIds":{"<INSTRUCTOR_ID>":"<INVITATION_ID>"}
  }' \
  --identity '{"subject":"<ADMIN_CLERK_ID>","email":"<ADMIN_EMAIL>","name":"<ADMIN_NAME>","role":"admin"}' \
  --codegen disable
```

Record from the result:

- `onboardingId`
- `perInstructor[0].workspaceId`
- `perInstructor[0].seatReservationId`
- `perInstructor[0].sessionPackId`

Notes:

- The student is recorded against `email:<normalized-email>` until they accept
  the invite. `clerk/user.created` (and the onboarding page's self-heal) rewrite
  the placeholder to the real Clerk id.
- The expiry is stored on the session pack and seat even when the customer
  email does not display it.
- The audit log attributes the action to the admin identity supplied above.

## Step 3 — Send the three emails

Send with Resend from the platform sender and capture each email id.

1. **Student** — account invitation, sign-in link, questionnaire, support
   contact. Omit the expiry date.
2. **Instructor** — new student, session cadence, 48-hour reach-out. Omit the
   student email address and the expiry date.
3. **Admins** — enrollment details, product/offer, and the actual delivery
   status of the student and instructor sends.

Verify status with `list-emails` / `get-email` before composing the admin
summary. Report the real status (`delivered`, `bounced`, …) — never hard-code
"delivered".

### Copy: student

> **Subject:** Welcome to Huckleberry Mentorships — your mentorship with `<Instructor Name>`
>
> Hi `<First Name>`,
>
> Your 1-on-1 mentorship with `<Instructor Name>` is ready for you. Create your
> account with the invitation link below, then complete your student onboarding
> questionnaire so `<Instructor First Name>` knows where to start.
>
> **Accept your invitation →** `<Clerk invitation link>`
>
> **What to do next**
> 1. Create your account using this email address (`<student email>`). This
>    invitation is unique to you, so please don't forward it.
> 2. Complete your onboarding questionnaire — tell `<Instructor First Name>`
>    about your goals and share 2–4 pieces of current artwork. You'll be taken
>    straight there after sign-up.
> 3. Sign in at `<APP_URL>` to open your dashboard and mentorship workspace.
>
> **Your mentorship**
> • Instructor: `<Instructor Name>`
> • Sessions: `<N>` sessions per month
>
> If you have any questions about payment or need help at any point, email us at
> `support@huckleberry.art`.
>
> Welcome aboard,
> The Huckleberry Mentorships team

### Copy: instructor

> **Subject:** New Huckleberry 1-on-1 Mentorship Student — `<Student Name>`
>
> Hi `<Instructor First Name>`,
>
> You have a new 1-on-1 mentorship student.
>
> **Student:** `<Student Name>`
> **Sessions:** `<N>` sessions per month
>
> `<Student Name>` has been sent an invitation to create their account and
> complete the onboarding questionnaire. Please reach out within 48 hours to
> schedule your first session.
>
> **View your students →** `<APP_URL>/instructor/students`

### Copy: admins

> **Subject:** [Admin] Kajabi onboarding — `<Student Name>` (`<student email>`) × `<Instructor Name>`
>
> **Kajabi onboarding completed — `<status>`**
>
> **STUDENT**
> Name: `<Student Name>`
> Email: `<student email>`
> Clerk invitation: `<inv_…>` (pending acceptance)
>
> **PRODUCT**
> `<product label>`
> Kajabi offer: `<offer id>`
> Offer link: `<offer url>`
>
> **INSTRUCTOR**
> `<Instructor Name>` — `<instructor email>`
> Clerk ID: `<instructor Clerk id>`
>
> **ENROLLMENT**
> Workspace: `<APP_URL>/dashboard/workspaces/<workspaceId>`
> Sessions: `<N>` per month
> Access through: `<date>`
> Onboarding record: `<onboardingId>`
>
> **EMAILS SENT (Resend)**
> 1. Student onboarding → `<student email>` — `<status>` — `<resend id>`
> 2. Instructor notification → `<instructor email>` — `<status>` — `<resend id>`
> 3. This admin summary → `<admin addresses>` — `<resend id>`

## Step 4 — Record the sends and close the onboarding

Write one delivery receipt per recipient, then close the row. Use the
`adminOnboardings` `attemptCount` (normally `1`).

```bash
# student
npx convex run adminOnboarding:markEmailSent \
  '{"onboardingId":"<ID>","recipient":{"kind":"student"},"resendMessageId":"<ID>","actorUserId":"<ADMIN_CLERK_ID>","expectedStatus":"processing","expectedAttemptCount":1}' \
  --codegen disable

# instructor
npx convex run adminOnboarding:markEmailSent \
  '{"onboardingId":"<ID>","recipient":{"kind":"instructor","instructorId":"<INSTRUCTOR_ID>"},"resendMessageId":"<ID>","actorUserId":"<ADMIN_CLERK_ID>","expectedStatus":"processing","expectedAttemptCount":1}' \
  --codegen disable

# each admin address
npx convex run adminOnboarding:markEmailSent \
  '{"onboardingId":"<ID>","recipient":{"kind":"adminSummary","email":"<ADMIN_EMAIL>"},"resendMessageId":"<ID>","actorUserId":"<ADMIN_CLERK_ID>","expectedStatus":"processing","expectedAttemptCount":1}' \
  --codegen disable

# close the row
npx convex run adminOnboarding:appendTimelineEntry \
  '{"onboardingId":"<ID>","event":"completed","actorUserId":"<ADMIN_CLERK_ID>","details":"Onboarded via email-first runbook","expectedStatus":"processing","expectedAttemptCount":1}' \
  --codegen disable
```

## Step 5 — Inventory

A real purchase consumed one seat, but the manual path does not decrement
inventory the way the Kajabi webhook does. Apply the same change the webhook
would have applied.

Convex HTTP actions are served from the `.convex.site` host, not the
`.convex.cloud` database host. With the usual `NEXT_PUBLIC_CONVEX_URL` value,
derive the site host before calling the endpoint — otherwise the request hits
the database URL and the seat stays available for sale:

```bash
CONVEX_SITE_URL="${NEXT_PUBLIC_CONVEX_URL/.convex.cloud/.convex.site}"
curl -sS -X POST "$CONVEX_SITE_URL/inventory/apply" \
  -H "Authorization: Bearer $CONVEX_HTTP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instructorSlug":"<slug>","type":"oneOnOne","quantity":1,"changeType":"kajabi_purchase","source":"kajabi","purchaseId":"kajabi:offer:<offerId>:onboarding:<onboardingId>"}'
```

`purchaseId` makes the change idempotent. Do not re-run with a new id for the
same sale.

## Step 6 — Questionnaire completion notification (built-in)

No manual action is needed for this step — the platform already does it — but
it only works when the Convex deployment has an Inngest event key.

**What is built:**

- `submitQuestionnaire` schedules `notifyInstructorOnSubmission`
  (`convex/onboardingQuestionnaireActions.ts`).
- That action emits `questionnaire/submitted` to Inngest.
- `onboardingQuestionnaireSubmittedNotification`
  (`apps/platform/inngest/functions/onboarding-questionnaire-submitted-notification.ts`)
  resolves every assigned instructor from the onboarding row and sends one
  email each via Resend, with a stable idempotency key.
- The email links to `<APP_URL>/onboarding/<onboardingId>`, where the assigned
  instructor sees the "Student questionnaire" card with answers, inspirations,
  work examples, and the timezone comparison. The same page is the instructor's
  review surface (no separate route).
- `notifiedInstructorAt` on the submission row is the cross-system dedupe claim;
  `reviews[]` records instructor review actions.

**Request shape:** the action posts to
`https://inn.gs/e/<INNGEST_EVENT_KEY>` with the event name in the JSON body
(Inngest's HTTP Event API). The key is a path segment, not a Bearer header.
An earlier version used `/e/questionnaire/submitted` with a Bearer header,
which returned `404` and silently skipped the emit; that is fixed.

**Required configuration (production):**

`INNGEST_EVENT_KEY` must be set on the **Convex deployment**, not just in Vercel.
Vercel env changes do not propagate to Convex.

```bash
npx convex env set INNGEST_EVENT_KEY <value>
npx convex env list   # confirm the name appears
```

Use the same event key the platform uses in Vercel (Inngest dashboard →
Manage → Event Keys). Never paste the value into a transcript, doc, or PR.

**How to confirm it is working:** after a real submission, the
`onboardingQuestionnaireSubmissions` row should have `notifiedInstructorAt` set
and the instructor should have a Resend send recorded. If the key is missing,
the action logs `INNGEST_EVENT_KEY not set; skipping event emit` and returns
`skipped` — no email is sent and no retry happens.

## Step 7 — Verify

- `adminOnboardings` row: `status: completed`, `emailsSent.student` true,
  `emailsSent.instructors` contains the instructor id,
  `emailsSent.adminSummaryByEmail` has both admin addresses, and the timeline
  ends with `completed`.
- `workspaces` row exists, named `<student email> × <instructor name>`, owned by
  `email:<student email>` until signup.
- Resend: all three sends show `delivered` (or a documented bounce).
- Clerk: exactly one pending invitation for the student email, with
  `public_metadata.role = "student"`.

## Admin notification routing

There are two separate concerns; both are needed.

### Outbound admin summaries (`ADMIN_EMAILS`)

`ADMIN_EMAILS` is read by the platform Inngest onboarding flows
(`apps/platform/inngest/functions/onboarding.ts`,
`admin-onboarding-stale-digest.ts`) and by the inventory API authorization
check (`apps/platform/app/api/instructor/inventory/route.ts`). Set it in the
**Vercel `mentorships-infra-platform` project** (Production and Preview) to the
admin mailboxes:

```env
ADMIN_EMAILS=huckleberryartinc@gmail.com,support@huckleberry.art
```

Rules:

- Do not put a display name in the value; it is a comma-separated address list.
- The value is inert until a new deployment builds. `NEXT_PUBLIC_*` is inlined at
  build time; server-side vars are snapshotted per deployment.
- The same variable gates the inventory API, so only add addresses that should
  be able to use that endpoint.
- Do not confuse it with `MARKETING_ADMIN_EMAILS` (marketing login allowlist) or
  with `EMAIL_REPLY_TO`.

### Inbound replies to `support@huckleberry.art`

`huckleberry.art` uses Google Workspace (`MX: smtp.google.com`), so this is a
Workspace configuration task, not a Resend setting:

1. Create a Google group `support@huckleberry.art`, **or** keep the mailbox and
   add forwarding rules.
2. Members / forwarding targets:
   - `huckleberryartinc@gmail.com`
   - `admin@huckleberry.art`
3. Verify both target addresses before saving forwarding.
4. Send a test from an external mailbox and confirm both targets receive it.

Until this is configured, replies land only in the `support@` mailbox. Outbound
mail keeps `Reply-To: support@huckleberry.art`; do not change it to a personal
Gmail address, because that exposes the personal address to students and
instructors and breaks the single public support address.

If a future change needs replies to reach both addresses without Workspace
forwarding, `packages/emails/src/send.ts` must accept an array for `replyTo`
(Resend supports multiple reply-to addresses). That is a code change and a
separate PR.

## Failure modes and rollback

| Failure | Handling |
| --- | --- |
| Clerk invitation fails | Stop. Do not commit the enrollment. Fix the cause (existing invitation, bad redirect URL) and retry. |
| Commit succeeds, email fails | Keep the row in `processing`, retry the failed email, then record receipts. Do not send the admin summary claiming success. |
| Student email bounces | Do not mark it delivered. Record `skipped`/failure with the reason, notify admins, and retry once the address is corrected. |
| Wrong instructor or session count | Cancel the onboarding row (`cancelAdminOnboarding`) and re-run with the correct values. Do not patch a `completed` row. |
| Duplicate enrollment created | Compare `adminOnboardings` by email and creation time. Cancel the newer row and release its placeholder artifacts. |

## Moving off Discord introductions

- Onboarding communication is email only: student sign-up/invite, instructor
  notification, admin summary.
- The onboarding flows no longer enqueue `dm_instructor_new_signup` or
  `assign_student_role`. `discordActionQueue` and the bot remain for the
  community server; use them only for community tasks.
- Discord is not used for introductions, student details, or scheduling
  hand-offs. Do not post student names or emails in Discord.
- The admin UI (`/admin/students`, `/admin/onboardings`) is the system of
  record. If a step is missing from the UI, add it there rather than creating a
  new side channel.

## Follow-ups

- Backfill `kajabiOfferMappings` for any offered product that is missing (e.g.
  offer `2149759054` for the public offer `ADNkiMXF`) so webhook purchases
  auto-onboard.
- Populate the instructor's `kajabiCheckoutUrlOneOnOne` when the public offer
  link exists.
- Set `ADMIN_EMAILS` in Vercel (see above).
- Set `INNGEST_EVENT_KEY` on the Convex deployment so questionnaire-submitted
  notifications reach instructors (see Step 6).
- Configure `support@huckleberry.art` forwarding (see above).
- Decide whether recurring "N sessions per month" offers should create a new
  pack each month. Today `sessionPacks` is a fixed count with `expiresAt`; the
  monthly cadence is only communicated in copy.
- Automate this runbook as an internal admin API (or an admin UI action) once
  the email copy stabilizes.

## Security notes

- Secrets stay in `.env.local` / the platform secret store. Never paste
  `CLERK_SECRET_KEY`, `CONVEX_HTTP_KEY`, or `RESEND_API_KEY` into a command
  transcript, PR, issue, or this doc.
- Clerk invitation links are single-use. Do not commit them, log them in a
  shared channel, or include them in the admin summary.
- Customer names and emails belong in the admin summary and Convex records, not
  in Discord or public docs.

# Onboarding Improvements (PR 12 — Clerk ID affordances, resend invitation, student onboarding page)

**Status (updated 2026-10-08):** PR 1 implementation complete — `<ClerkUserIdCell>` shared component, `getClerkDashboardUserUrl` helper, and 9 ad-hoc Clerk-id render sites replaced. Branch `feat/onboarding-improvements-pr1-clerk-user-id-cell` ready for Greptile + CodeRabbit review.

**Target branch:** `main`
**Apps affected:** `apps/platform` (admin + instructor surfaces, new `/onboarding/[id]` route)
**Estimated scope:** 4 PRs (PR 1 small, PR 2–4 medium), new shared UI component, two new Convex tables, one new Convex mutation, one new Inngest-free background pipeline.

### Deviations from the original PR 1 plan (locked-in during implementation)

- **Dashboard URL source changed** from "decode publishable key + call `clerkClient.instance.get()`" to **a single `NEXT_PUBLIC_CLERK_APP_ID` env var**. The Clerk Backend SDK installed (`@clerk/backend@3.18.1` via `@clerk/nextjs@7.3.4`) does **not** expose an `instance.get()` method — verified by grepping installed `.d.ts` files. The publishable-key base64 segment decodes to the Clerk frontend API host, not the app ID. User picked the env-var option after the constraint was surfaced. The env var is `NEXT_PUBLIC_*` so it ships to the client and works without any SDK call. Placeholder documented in `.env.example`; Vercel + local `.env.local` must be updated before the "Open in Clerk" link renders.
- **Component prop renamed** from `userId` to `id` because the cell also renders a Clerk **invitation id** (`admin-onboarding-form.tsx` success card, per the §5.1 acceptance list). The Clerk dashboard URL pattern for invitations differs (`/invitations/{id}` vs `/users/{userId}`), so the invitation-id caller passes `showDashboardLink={false}` and relies on the copy button only.
- **Two render sites disable both buttons** for layout reasons: `workspaces/create/page.tsx` (instructor search fallback inside a clickable list item) and `products/page.tsx` (instructor filter `SelectItem`). The cell still renders the truncated `<code>` so the truncation source-of-truth is centralised, but adding copy/dashboard buttons in those tight spaces would create nested-button / nested-anchor UX.

---

## 1. Goal

Replace the ad-hoc rendering of Clerk user IDs across `apps/platform/admin/*` with a shared, deep-linkable component; add a first-class "resend invitation" action that mints a fresh Clerk invite without duplicating workspaces or rows; ship a two-surface onboarding experience (`/onboarding/[id]` status page + `/onboarding/[id]/questionnaire` form) so students and instructors can see and progress through the onboarding flow instead of relying on the Clerk invitation email alone.

## 2. Why now

- Admin/support engineers currently cannot identify users from Clerk IDs in the UI without copy-pasting into the Clerk dashboard. The audit found 7+ call sites with three different truncation conventions (8 / 12 / full) and zero dashboard deep-links.
- The instructor onboarding flow is essentially the Clerk invitation email — there is no shared visibility into where the student is in the process, no questionnaire, and no review step.
- The recovery path (`/api/admin/onboardings/[id]/retry`) re-emits the Inngest event but does not re-mint a Clerk invitation, so a failed invite cannot be revived without cancelling + re-onboarding (which creates a new `adminOnboardings` row and risks duplicating session packs).

## 3. Scope

### 3.1 In scope

- **Clerk ID cell** (`<ClerkUserIdCell>`): shared component with copy-to-clipboard + "Open in Clerk" deep-link; replace ad-hoc `userId.slice(0,8)+"…"` across admin and instructor tables.
- **Resend invitation** (`resendAdminOnboardingInvitation` mutation + `/api/admin/onboardings/[id]/resend-invitation` route + `ResendInvitationButton`): revokes the prior Clerk invite, mints a fresh one, updates `studentInvitations.clerkInvitationId` if `isSeparateStudentRecord`, never mutates workspace rows, records an `invitation_resent` timeline event.
- **Onboarding status page** (`/onboarding/[id]`): shared student + instructor view. Stepper over three steps (Signed up → Tell us about yourself → Ready for your first call). Permission-gated to assigned student + each assigned instructor + admin/support. The instructor's view is read-only.
- **Questionnaire form** (`/onboarding/[id]/questionnaire`): three questions (how-did-you-hear, goals, inspirations) + 4–6 work-example image uploads (≤ 8 MB per image, jpg/png/webp/gif). Auto-saves on every field change (no save-draft button). Stored in a new `onboardingQuestionnaireSubmissions` table; images in a new `onboardingWorkExamples` table backed by B2 with a dedicated `onboarding/{onboardingId}/` prefix.
- **Inspirations question**: 3–4 entries, each with just a `name` field (no "why inspired" sub-field — too much friction).
- **Auto-resume on sign-in**: when a student signs in with an incomplete questionnaire, the post-auth redirect routes them to `/onboarding/[id]` instead of the default dashboard. They don't need to memorize any URL.
- **Abandonment reminder**: if a student closes the form without submitting, an email reminder fires. Two triggers — a `navigator.sendBeacon` on `beforeunload` for explicit closes, and an Inngest cron (every 30 min, scans drafts `updatedAt < now - 1h`) as the safety net. Cap at 3 reminders per draft.

### 3.2 Out of scope

- Student-self-serve cancellation (instructor/Support must cancel from the recovery dashboard).
- Multi-instructor onboarding — out of scope for this arc; the actual product is 1:1. The data model already supports multiple instructors via per-instructor session packs; per-instructor decisions can be added as a follow-up if the product ever needs it.
- Instructor-driven Accept / Request changes flow — out of scope. The questionnaire is informational; the instructor reads it when preparing for the first call. No instructor approval step, no resubmission cycle.
- Bulk re-invite UI (e.g., "resend all stale invites") — out of scope; only per-row resend ships.
- Reskinning of the existing `/admin/onboardings/*` list/detail pages — those keep the current chrome; PR 1 only swaps the cell, the others add new affordances alongside.
- Server-side image processing (EXIF strip, mime sniff, transcoding). Bytes are stored as-uploaded, same as the workspace image pipeline.
- New file upload backend. We reuse the existing B2 workspace pipeline (`convex/workspaceStorage.ts`) — see PR 4 for the prefix isolation.

### 3.3 Student experience walk-through (post-implementation)

This is the student-facing flow after all four PRs ship. It anchors the implementation plan so future contributors can read the intended UX without spelunking the schema.

**Trigger.** Admin enters the student's email in the existing Full-onboarding form at `/admin/students` (the `adminOnboarding` form, unchanged by these PRs). On submit: `adminOnboardings` row created, Clerk invitation sent via Resend.

**Step 1 — Student receives the email and signs up.**

- Clicks the Clerk sign-up link, creates their account.
- Clerk public metadata carries `{ role: "student", onboardingId: <id> }` (added by PR 3).
- Clerk redirects to `/sign-up-redirect` → reads metadata → routes to `/onboarding/[onboardingId]` instead of `/dashboard`.

**Step 2 — Student lands on `/onboarding/[id]` (status page).**

- Header: "Welcome, [student name]. Let's get you set up."
- 3-step stepper: ✓ Create your account · **Tell us about yourself** (active) · Ready for your first call (pending).
- Copy: "Help your instructor understand your background and goals before your first call. Takes about 10 minutes."
- Primary CTA: **Start questionnaire** → `/onboarding/[id]/questionnaire`.

**Step 3 — Student fills out the questionnaire (`/onboarding/[id]/questionnaire`).**

Three questions + an uploader:

1. **"How did you learn about this mentorship?"** — textarea, 2000 chars, required.
2. **"What are your goals with art and this mentorship?"** — textarea, 4000 chars, required.
3. **"Who are your artistic inspirations?"** — 3–4 entries, each a single `name` field. Add/remove inline; can't go below 3 or above 4.
4. **"Upload examples of your work"** — drag-and-drop, 4–6 images, ≤ 8 MB each, jpg/png/webp/gif. Live thumbnails.

Auto-save on every field change. No save-draft button. If the student navigates away mid-fill, the draft is preserved.

**Step 4 — Student submits.**

- Clicks **Submit**.
- Validation: all required fields, 3–4 inspirations, 4–6 work examples.
- `onboardingQuestionnaireSubmissions` row flips to `submitted`, `submittedAt` stamped.
- A `questionnaire_submitted` timeline event is appended to `adminOnboardings` (visible on the admin detail page).
- Status page now shows all 3 steps complete.

**Step 5 — Confirmation screen.**

- All 3 steps show ✓.
- Copy: "Thanks! Your instructor will reach out to schedule your first call."
- No further action required.

**Returnability — what happens when the student closes the tab mid-questionnaire.**

Two systems keep the student from getting lost:

1. **Auto-resume on sign-in.** When the student signs in (Clerk), the post-auth redirect calls `getIncompleteOnboardingForCurrentUser`. If a draft exists, the redirect routes them to `/onboarding/[onboardingId]` instead of the role-default dashboard. They don't need to memorize any URL — they sign in and they're back where they were.

2. **Abandonment reminder email.** Two triggers:
   - **Beacon:** `navigator.sendBeacon('/api/onboarding/[id]/abandoned')` on `beforeunload` with an incomplete form. Fires within minutes.
   - **Cron:** Inngest scheduled function `checkStaleOnboardingDrafts` runs every 30 minutes. Queries for `onboardingQuestionnaireSubmissions` where `status === "draft"`, `updatedAt < now - 1h`, and no reminder sent in the last 1h. Sends the reminder email via Resend.

Both write through the same `lastReminderSentAt` / `reminderCount` fields on the submission row. Cap at 3 reminders total per draft. After 3, an admin has to intervene.

The reminder email contains a link to `/sign-in?redirect_url=/onboarding/[onboardingId]/questionnaire`. Clerk's built-in `redirect_url` handling takes care of sign-in-then-route-back. When the student clicks: signed in → straight to the pre-filled questionnaire; not signed in → Clerk sign-in → redirect to the questionnaire.

**Meanwhile, on the instructor's side.**

- Instructor logs in, opens the student's profile (existing flow).
- Can open `/onboarding/[id]` and see the submitted questionnaire read-only. No buttons — they read what the student submitted when preparing for the first call.
- Uses the existing scheduling/bookings flow to set up the first mentorship call. Not part of this arc.

**What stays outside this flow.**

- The first mentorship call itself (scheduling, Daily.co, recording) — existing flow, untouched.
- Resend of the invitation (PR 2) — admin-side action, not on the student's path.

## 4. Current state (audit snapshot)

| Topic | File:line | Current behaviour |
|---|---|---|
| Ad-hoc Clerk ID truncation | `apps/platform/app/admin/students/page.tsx:230,234,279`; `apps/platform/app/admin/workspaces/page.tsx:177`; `…/workspaces/[id]/page.tsx:197`; `…/workspaces/[id]/members/page.tsx:263`; `…/workspaces/create/page.tsx:207`; `apps/platform/app/admin/products/page.tsx:325`; `…/admin/orders/page.tsx:325`; `…/admin/audit-logs/page.tsx:114,326` | Mixed 8 / 12 / full-char render, no copy, no dashboard link |
| Reconciliation banner (raw full id) | `apps/platform/app/instructor/students/page.tsx:223-265` | Full id in `<code>`, no link |
| Onboarding-form success card | `apps/platform/components/admin/admin-onboarding-form.tsx:848-850` | Full `clerkInvitationId` in `<code>` |
| Existing copy helper (not wired for IDs) | `apps/platform/app/admin/orders/page.tsx:71-73` | `copyToClipboard` used only for order IDs |
| Onboarding state machine | `convex/adminOnboarding.ts:17-23` | `queued → processing → completed\|failed\|cancelled`; transitions enforced |
| Timeline event union | `convex/adminOnboarding.ts:998-1010` | `queued\|processing_started\|email_sent\|discord_queued\|completed\|failed\|retrying\|cancelled\|capacity_override\|alias_set\|released` |
| Status-to-label mirror | `apps/platform/lib/admin-onboarding.ts:113-128` | Client-side; `released` falls through to default |
| Invitation mutation | `apps/platform/app/api/admin/students/onboard/route.ts:148-209` | Mints one Clerk invite per onboarding; no resend |
| Retry action | `apps/platform/app/api/admin/onboardings/[id]/retry/route.ts` + `convex/adminOnboarding.ts:615` | Re-emits Inngest; does NOT re-mint Clerk invite (TODO at `…/onboard/route.ts:240`) |
| Workspace decoupling | `apps/platform/app/admin/workspaces/create/page.tsx`; `convex/adminWorkspaces.ts:169,229,282` | Workspace creation is separate from onboarding commit |
| Image upload pipeline | `apps/platform/lib/b2-workspace-upload.ts:46-80`; `convex/workspaceStorage.ts:593,806` | B2 + signed PUT + ledger, `MAX_IMAGE_BYTES = 8 MB`, `PER_UPLOAD_CAP = 5` |
| Shared image upload component | `packages/ui/src/components/image-upload-field.tsx:19-42` | One component for both admin endpoints; not currently used for B2 |
| Workspace-constants handshake | `convex/workspaceConstants.ts` ↔ `apps/platform/lib/workspace-constants.ts:1-5` | Both files must be updated together (comment-only contract) |
| Doc convention reference | `docs/plans/pr-11-workspace-storage-b2.md:235` | PR-by-PR sections, widen→migrate→narrow cadence |

## 5. Implementation plan

### 5.1 PR 1 — `<ClerkUserIdCell>` shared component (smallest)

**Status:** implementation complete on branch `feat/onboarding-improvements-pr1-clerk-user-id-cell`.

**Files touched**

- New: `packages/ui/src/components/clerk-user-id-cell.tsx`
- New: `apps/platform/lib/clerk-dashboard-url.ts` — `getClerkDashboardUserUrl(id: string): string | null`. Implementation:
  1. Read `process.env.NEXT_PUBLIC_CLERK_APP_ID` (added to `.env.example`; placeholder `app_your_clerk_app_id_here`). The Clerk Backend SDK does not expose a way to derive the app id from the publishable key, so the env var is the source of truth.
  2. Construct `https://dashboard.clerk.com/apps/${appId}/users/${encodeURIComponent(id)}` and return it. Module-level `warned` flag suppresses the missing-env-var warning to one `console.warn` per process.
  3. Returns `null` when the env var is missing — the cell renders the copy button only and the dashboard link is hidden.
- New: `apps/platform/components/admin/clerk-user-id-cell.tsx` — one-line re-export from `@mentorships/ui` (mirrors `apps/platform/components/admin/image-upload-field.tsx`).
- Edit (replace ad-hoc truncation): the 9 files in §4 row 1, plus the full-id render in the reconciliation banner and the onboarding-form success card.

**API surface**

```ts
interface ClerkUserIdCellProps {
  id: string;                           // the Clerk resource id (`user_xxx` or `inv_xxx`)
  truncateAt?: number;                  // default 8; pass 0 to always show full
  showCopyButton?: boolean;             // default true
  showDashboardLink?: boolean;          // default true; uses getClerkDashboardUserUrl
  label?: string;                       // optional pre-label e.g. "Clerk ID:"
  dashboardUrl?: string | null;         // pre-computed URL; pass null to disable link
  orientation?: "row" | "column";      // default "row"
  className?: string;
}
```

**Acceptance**

- All 11 call sites from §4 render the new component. ✓
- Copy button writes the full id to the clipboard and shows a 2-second confirmation (Check icon swap, no toast library). ✓
- "Open in Clerk" link opens `https://dashboard.clerk.com/apps/${appId}/users/${userId}` in a new tab with `rel="noopener noreferrer"`. Hidden when `NEXT_PUBLIC_CLERK_APP_ID` is unset. ✓
- Truncation default is 8 chars with `…`; hover tooltip shows the full id (covered by `title` attr on the `<code>` element). ✓
- No new CSS dependencies; uses the existing `Button` primitive + inline Tailwind classes. (Plan called for a `Tooltip` primitive; `packages/ui` does not have one — used `title` attr instead, which is sufficient for the use case.)

### 5.2 PR 2 — Resend invitation action (medium)

**Files touched**

- Edit: `convex/adminOnboarding.ts` — add `resendAdminOnboardingInvitation({ onboardingId })` mutation:
  - Authorisation: `requireAdminOrSupportForApi` (existing helper).
  - Refuse if `status === "completed"` or `cancelled` → `throw new ConvexError({ code: "TERMINAL", message: "Cannot resend — onboarding already completed/cancelled" })`.
  - Best-effort revoke prior Clerk invite via `clerkClient.invitations.revokeInvitation(prevInvitationId)`; ignore `404` / `already_revoked` errors with a warn log.
  - Mint a fresh invite via `createStudentClerkInvitation({ emailAddress, redirectUrl })` (existing helper at `apps/platform/lib/clerk-invitations.ts:75-95`); the redirect URL is unchanged from the original.
  - If `isSeparateStudentRecord === true`, patch `studentInvitations.clerkInvitationId` and bump the row's `updatedAt`.
  - Append timeline event `{ event: "invitation_resent", actorUserId, timestamp, details: { previousInvitationId, newInvitationId } }`. Update the timeline event union at `convex/adminOnboarding.ts:998-1010` to include `invitation_resent`. Mirror in `apps/platform/lib/admin-onboarding.ts:130-154` (timelineEventLabel map).
- New: `apps/platform/app/api/admin/onboardings/[id]/resend-invitation/route.ts` — thin wrapper that calls the mutation and returns the new `clerkInvitationId`. Same shape as the existing `retry` route.
- New: `apps/platform/components/admin/resend-invitation-button.tsx` — `<ResendInvitationButton onboardingId>` with a confirmation dialog ("This will revoke the previous invitation and send a new email. Existing workspaces will not be affected.").
- Edit: `apps/platform/app/admin/onboardings/[id]/page.tsx` — place the button next to the existing `RetryOnboardingButton`. Disable when `status` is `completed` / `cancelled`.

**Idempotency guarantees**

- Resending never creates a second `adminOnboardings` row.
- Resending never creates or duplicates `workspaces` rows.
- Resending updates at most one `studentInvitations.clerkInvitationId` (the one tied to this onboarding, only when `isSeparateStudentRecord`).
- Concurrent resends: the mutation writes a timeline entry with `expectedAttemptCount` (TOCTOU guard pattern, same as `appendTimelineEntry`).

**Acceptance**

- Resending on a `queued` row produces a fresh Clerk invite and a `invitation_resent` timeline entry; the row stays in `queued`.
- Resending on a `failed` row revives the invitation pipeline; the row flips to `processing` (use the existing transition via `retryAdminOnboarding` AFTER the new invite is minted).
- Resending on a `completed` row throws `TERMINAL`; the UI surfaces the error in a toast.
- Workspace count is unchanged before and after the resend (asserted in a test).

### 5.3 PR 3 — Onboarding status page `/onboarding/[id]` (medium)

**Files touched**

- New: `convex/onboardingViews.ts` (or extend `convex/adminOnboarding.ts`):
  - `getOnboardingView({ onboardingId })` — returns a denormalised view: status, timeline (last 50 + count of older entries), assigned student + instructor pair, current step (derived from timeline events).
  - Permission: identity must equal `assignedStudentClerkId` OR be one of the assigned instructors (`by_instructorId` lookup) OR `requireAdminOrSupportForApi`.
- New: `apps/platform/app/onboarding/[id]/page.tsx` — server component, fetches the view, renders:
  - Header: instructor name(s), student name (if visible), status badge (uses the same `STATUS_LABELS` from `apps/platform/lib/admin-onboarding.ts:113-128`).
  - Stepper (4 steps) with the current step highlighted; copy explains what happens at each step.
  - For the student: action button on the current step (e.g., "Continue questionnaire" → routes to `/onboarding/[id]/questionnaire`).
  - For the instructor: review panel appears once status indicates the questionnaire is submitted (see PR 4 for the actual signal).
  - For both: a help footer linking to a contact email.
- New: `apps/platform/components/onboarding/onboarding-stepper.tsx` — read-only visual component shared between student and instructor views.
- Edit: `apps/platform/lib/clerk-invitations.ts:75-95` — set Clerk public metadata `{ role: "student", onboardingId, isStudent: true }` on the new invite (so the post-signup redirect can route to `/onboarding/[onboardingId]` directly).
- Edit: `apps/platform/app/sign-up-redirect/page.tsx` — read `onboardingId` from Clerk public metadata and route to `/onboarding/[onboardingId]` instead of `/dashboard` for student role.
- Edit: `apps/platform/app/auth-redirect/page.tsx` — extend the existing post-auth redirect to also call `getIncompleteOnboardingForCurrentUser`. If a draft submission exists, redirect to `/onboarding/[onboardingId]` instead of the role-default dashboard. (This handles the "student closed the tab and came back to sign in" case — they don't need to know any URL.)
- Edit: `apps/platform/lib/admin-onboarding.ts:113-128` — extend `STATUS_LABELS` only if new derived sub-states are needed (likely not; keep status-only).

**Acceptance**

- A student who accepts the Clerk invite lands on `/onboarding/[id]`, not `/dashboard`.
- The instructor sees the same stepper; step 3 (Questionnaire submitted) reflects reality.
- A non-assigned user (signed in as a different student) gets a 404, not a 403, to avoid existence leakage.
- The page works for both a row with `status === "queued"` (show "Waiting for you to sign up") and `status === "processing"` (show questionnaire CTA).
- A student who closes the tab mid-questionnaire and signs back in is auto-routed to `/onboarding/[id]` (with the questionnaire CTA visible), not the default dashboard.

### 5.4 PR 4 — Questionnaire + work examples + abandonment reminder (largest)

**Schema additions** (`convex/schema.ts`)

```ts
onboardingQuestionnaireSubmissions: defineTable({
  onboardingId: v.id("adminOnboardings"),
  studentClerkId: v.string(),
  questionnaireVersion: v.number(),            // bumped when ONBOARDING_QUESTIONS changes
  status: v.union(v.literal("draft"), v.literal("submitted")),
  howDidYouHear: v.string(),
  goals: v.string(),
  inspirations: v.array(v.object({              // just `name` — no "why inspired" sub-field
    name: v.string(),
  })),                                          // length-validated 3..4 in mutation
  createdAt: v.number(),
  updatedAt: v.number(),                        // set on every save; used by the cron
  submittedAt: v.optional(v.number()),
  lastReminderSentAt: v.optional(v.number()),   // cron dedupe + anti-spam
  reminderCount: v.optional(v.number()),        // capped at 3 per draft
})
  .index("by_onboardingId", ["onboardingId"])
  .index("by_status_updatedAt", ["status", "updatedAt"])   // cron query path

onboardingWorkExamples: defineTable({
  onboardingId: v.id("adminOnboardings"),
  uploadedBy: v.string(),           // Clerk userId
  b2Key: v.string(),
  contentType: v.string(),
  size: v.number(),
  status: v.union(v.literal("pending"), v.literal("active"), v.literal("deleted")),
  uploadedAt: v.number(),
  deletedAt: v.optional(v.number()),
}).index("by_onboardingId_active", ["onboardingId", "status"])
```

**Constants** (`convex/workspaceConstants.ts` + mirror in `apps/platform/lib/workspace-constants.ts`)

- `MAX_WORK_EXAMPLE_BYTES = 8 * 1024 * 1024` (same as `MAX_IMAGE_BYTES`; reuses validation path).
- `MAX_WORK_EXAMPLES_PER_ONBOARDING = 6` (above the workspace `PER_UPLOAD_CAP = 5`; this single-use case allows 6).
- `MIN_INSPIRATIONS = 3`, `MAX_INSPIRATIONS = 4` (the user said "provide 3–4 artist examples").
- `ONBOARDING_WORK_EXAMPLES_B2_PREFIX = "onboarding"` (used in `generateWorkExampleUploadUrl`).
- `ONBOARDING_REMINDER_STALE_MS = 60 * 60 * 1000` (1 hour).
- `ONBOARDING_REMINDER_MAX_COUNT = 3`.

**The three canonical questions** (lives in `apps/platform/lib/onboarding-questions.ts` as a typed const):

1. **"How did you learn about this mentorship?"** — textarea, 2000 chars, required.
2. **"What are your goals with art and this mentorship?"** — textarea, 4000 chars, required.
3. **"Who are your artistic inspirations?"** — 3–4 entries, each a single `name` field, required.

**Files touched**

- New: `apps/platform/lib/onboarding-questions.ts` — typed const `ONBOARDING_QUESTIONS` with id/label/type/maxLength/required metadata. Bumping the const requires a `questionnaireVersion` increment in the same file.
- New: `convex/onboardingQuestionnaire.ts` — mutations:
  - `getIncompleteOnboardingForCurrentUser` — query used by the post-auth redirect in PR 3. Returns the most recent `adminOnboardings` row for the signed-in user where the student has signed up AND no `onboardingQuestionnaireSubmissions` row with `status === "submitted"` exists for it.
  - `saveQuestionnaireDraft({ onboardingId, howDidYouHear, goals, inspirations })` — auto-save entry point. Called by the form on every field change (debounced ~500ms). Upserts the submission row with `status: "draft"` and updates `updatedAt`. No-op if the row is already `submitted`.
  - `submitQuestionnaire({ onboardingId, howDidYouHear, goals, inspirations })` — sets status `submitted`, stamps `submittedAt`, appends `questionnaire_submitted` timeline event to `adminOnboardings`. Validates: all required fields non-empty; `inspirations.length ∈ [3, 4]`; ≥ 4 active work examples (hard block below 4; no soft warning).
- New: `convex/onboardingWorkExamples.ts` — actions/mutations:
  - `generateWorkExampleUploadUrl({ onboardingId, contentType, size })` — same shape as `signedWorkspaceUploadUrl` (`convex/workspaceStorage.ts:660`), but `b2Key = ${ONBOARDING_WORK_EXAMPLES_B2_PREFIX}/${onboardingId}/${fileId}`. Validates `MAX_WORK_EXAMPLE_BYTES` and that active examples count + 1 ≤ `MAX_WORK_EXAMPLES_PER_ONBOARDING`.
  - `recordWorkExampleUpload({ onboardingId, b2Key, contentType, size })` — analogous to `recordB2FileUpload`. Re-verifies authorisation (`studentClerkId === identity.subject`) and B2 HEAD verify.
  - `listWorkExamples({ onboardingId })` — read-only, used by the instructor view.
  - `deleteWorkExample({ onboardingId, b2Key })` — student-initiated, only allowed while submission `status === "draft"`.
  - `purgeWorkExamples({ onboardingId })` — internal mutation called when `adminOnboardings` reaches a terminal status. Deletes B2 objects + marks rows `deleted`.
- New: `convex/onboardingReminders.ts`:
  - Internal mutation `recordAbandonment({ onboardingId })` — called by the beacon API route. Stamps `lastSeenAt` and bumps `reminderCount` (the cron separately increments `lastReminderSentAt`).
  - Inngest scheduled function `checkStaleOnboardingDrafts` — runs every 30 minutes. Queries `onboardingQuestionnaireSubmissions` where `status === "draft"`, `updatedAt < now - ONBOARDING_REMINDER_STALE_MS`, `reminderCount < ONBOARDING_REMINDER_MAX_COUNT`. For each match, sends the reminder email via Resend and updates `lastReminderSentAt` + `reminderCount`. Re-checks submission status immediately before sending (handles the race where the student submits between query and send).
- New: `apps/platform/app/api/onboarding/[id]/abandoned/route.ts` — thin POST handler that calls `recordAbandonment`. Accepts `sendBeacon` payloads (small JSON body, no auth header — relies on the `onboardingId` URL param + server-side permission check that `identity.subject` is the assigned student for that onboarding).
- New: Resend email template at `apps/platform/emails/onboarding-reminder.tsx` (subject: "Finish your mentorship onboarding"; body has a single CTA button linking to `/sign-in?redirect_url=/onboarding/[onboardingId]/questionnaire`). I'll confirm the existing template location in PR 4 prep.
- New: `apps/platform/components/onboarding/onboarding-questionnaire-form.tsx` — multi-section form using existing form primitives from `packages/ui/src/components/form.tsx`. Sections: How did you hear (textarea), Goals (textarea), Inspirations (dynamic array of 3–4 entries with single `name` field), Work examples (uses a thin wrapper around `apps/platform/lib/b2-workspace-upload.ts` that points at `generateWorkExampleUploadUrl`).
  - Registers a `beforeunload` listener that calls `navigator.sendBeacon('/api/onboarding/[id]/abandoned', ...)` when the form has any unsaved input AND `status === "draft"`.
  - Auto-saves on every field change via a debounced (500ms) call to `saveQuestionnaireDraft`. No explicit "Save draft" button.
  - Single Submit button at the bottom. Submit calls `submitQuestionnaire`.
- New: `apps/platform/app/onboarding/[id]/questionnaire/page.tsx` — student-only route. Permission check via `getOnboardingView` + a derived `currentStudentClerkId` match. If a `submitted` row already exists, render a "you've already completed this" message instead of the form.
- Edit: `apps/platform/app/onboarding/[id]/page.tsx` (PR 3) — instructor view: if a `submitted` row exists, render the answers (read-only) + image gallery of active work examples. No buttons. If the student hasn't submitted yet, render "Awaiting student's questionnaire."

**B2 lifecycle**

- On `adminOnboardings.status → completed` or `cancelled`, the existing Inngest pipeline emits an event consumed by a new function that calls `purgeWorkExamples` (deletes B2 objects + marks rows `deleted`). Mirrors the pattern in `apps/platform/inngest/functions/onboarding.ts`.

**Acceptance**

- Student can fill out the form, navigate away, sign back in, and resume exactly where they left off (auto-save + auto-resume on sign-in from PR 3).
- Student can upload 4–6 images, each ≤ 8 MB, jpg/png/webp/gif only. Live thumbnails.
- Submitting locks the submission to read-only for the student. Subsequent `saveQuestionnaireDraft` calls are no-ops.
- Closing the tab with an incomplete form fires a beacon → reminder email is sent within ~5 minutes (if the beacon makes it through) or within ~1.5 hours (cron fallback).
- Walking away with the laptop closed (no beacon) results in a reminder email within ~1.5 hours.
- The reminder link routes through Clerk sign-in and lands the student on the pre-filled questionnaire.
- A single abandoned draft receives at most 3 reminders; the 4th never fires.
- Submitting the form after a beacon fires but before the email sends does not produce an unnecessary email (status re-check at send time).

## 6. Verification (per PR)

| PR | Commands |
|---|---|
| 1 | `pnpm --filter @mentorships/ui typecheck`; `pnpm --filter apps-platform typecheck`; `pnpm --filter apps-platform lint`; Greptile local review (`npx greptile@latest review`) |
| 2 | `pnpm --filter apps-platform typecheck`; `pnpm --filter apps-platform lint`; Convex test: extend `convex/adminOnboarding.test.ts` (if absent, scaffold per `docs/plans/pr-6-testing-infrastructure.md`) with cases for completed/cancelled refusal and idempotent workspace counts; `pnpm test --filter apps-platform` |
| 3 | `pnpm --filter apps-platform typecheck`; manual: impersonate a student via `clerk impersonate <email> --open` to walk through `/onboarding/[id]` (post-signup); close the tab mid-questionnaire, sign back in to confirm auto-resume routes to `/onboarding/[id]`; impersonate an unrelated student to confirm 404 |
| 4 | `pnpm --filter apps-platform typecheck`; `pnpm --filter apps-platform lint`; Convex test: extend `convex/onboardingQuestionnaire.test.ts` with inspiration-length validation, example-count cap, terminal-status purge trigger; Convex test: extend `convex/onboardingReminders.test.ts` with stale-draft detection, max-3 cap, send-time status re-check; live B2 PUT smoke against the `onboarding/` prefix; manual: end-to-end flow student fills → submits → admin sees `questionnaire_submitted` event → instructor reads on `/onboarding/[id]` |

All four PRs follow the **PR Merge Policy** in AGENTS.md (Greptile + CodeRabbit both approve before merge; fallback to Greptile alone if CodeRabbit skip-review fires).

## 7. Acceptance criteria

- [ ] All 11 ad-hoc Clerk-id render sites in `apps/platform` use `<ClerkUserIdCell>`.
- [ ] `<ClerkUserIdCell>` copy-to-clipboard works without external libraries beyond `navigator.clipboard`.
- [ ] "Open in Clerk" link opens the correct dashboard URL for the app's Clerk instance (verified by `getClerkDashboardUserUrl` returning a non-empty string in dev).
- [ ] Resend works on `queued`, `processing`, and `failed` rows.
- [ ] Resend is refused on `completed` and `cancelled` rows with a clear UI message.
- [ ] Resend never increases the count of `adminOnboardings`, `workspaces`, or `studentInvitations` rows for the same onboarding.
- [ ] `/onboarding/[id]` is reachable from the Clerk invitation email redirect and renders correctly for both student and instructor identities.
- [ ] A non-assigned Clerk user gets a 404 from `/onboarding/[id]` (not a 403).
- [ ] The questionnaire has three questions (how-did-you-hear, goals, inspirations) and the inspirations field is just `name` (no `why inspired`).
- [ ] Questionnaire submission enforces 3–4 inspirations and 4–6 work examples.
- [ ] Work-example uploads enforce 8 MB per file and the allowed mime set.
- [ ] Auto-save: every field change persists to the draft row within ~500ms. No save-draft button.
- [ ] Auto-resume: a student who closes the tab mid-questionnaire and signs back in lands on `/onboarding/[id]`, not the default dashboard.
- [ ] Abandonment beacon: closing the tab with an incomplete form fires a reminder email within ~5 minutes (when the beacon makes it through).
- [ ] Abandonment cron: a draft `updatedAt < now - 1h` results in a reminder email within ~1.5 hours.
- [ ] Reminder cap: a single abandoned draft receives at most 3 reminders; the 4th never fires.
- [ ] Submitting the form after a beacon fires but before the email sends does not produce an unnecessary email (status re-check at send time).
- [ ] `docs/plans/README.md` index updated with a one-line status entry per shipped PR.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Clerk dashboard URL helper breaks when `NEXT_PUBLIC_CLERK_APP_ID` is unset | Fall back to deriving from the publishable key; log a clear runtime warning. Surface in PR 1 acceptance test. |
| Resend could race with the student accepting the previous invite | Refuse the resend if `studentInvitations.status === "accepted"` (read it after revoke attempts). Toast says "student already signed up — view their profile instead." |
| Auto-save flooding the database on every keystroke | Field-change save is debounced (~500ms) at the component level. Convex charges per-mutation; bounded write rate per active student. |
| Abandonment beacon never reaches the server (network drop, browser kill) | The Inngest cron every 30 min catches stale drafts (`updatedAt < now - 1h`) and sends the reminder within ~1.5h. Worst case: a student closes the laptop with no signal and gets the email at the next cron tick. |
| Reminder email sent after student submits between query and send | `checkStaleOnboardingDrafts` re-reads `status === "draft"` immediately before sending and skips if it flipped. |
| Status page leaks student name to non-assigned instructors if `assignedStudentClerkId` lookup is wrong | Permission check returns 404, not 403, on failure. Test in PR 3. |
| `MAX_WORK_EXAMPLES_PER_ONBOARDING = 6` is one above the workspace `PER_UPLOAD_CAP = 5` and could confuse the shared client helper | The onboarding form uses its own thin wrapper around `b2-workspace-upload.ts` that bypasses `PER_UPLOAD_CAP`. Documented at the wrapper's `JSDoc`. |
| Question/answer schema migrations | Question text is stored verbatim per submission, not via a foreign key — there's no schema migration cost. If question wording changes between PR 4 and a later revision, old submissions are preserved as-is. |

## 9. Follow-up PRs (not in this arc)

- Bulk resend UI ("resend all stale invites") on `/admin/onboardings`.
- Student-self-serve cancellation from the onboarding page.
- "Resume onboarding" banner on `/dashboard` for incomplete questionnaires (belt-and-suspenders on top of the auto-resume redirect).
- Per-onboarding timeline pagination UI (the `MAX_TIMELINE = 50` cap at `convex/adminOnboarding.ts:1046` will eventually need a "view older entries" affordance — separate scope).
- Resend for the legacy `/api/admin/students/invite` flow (PR 2 only covers `adminOnboardings`-driven invites).
- Per-program questionnaire customization (if a sculpture program needs different questions than a painting program). Add a `questionnaireTemplates` table; submissions already store question text per answer so old submissions render correctly without migration.
- Multi-instructor onboarding flow (if the product ever pairs a student with two or more instructors on one onboarding row). Either model as one `adminOnboardings` row per instructor pair, or add a per-instructor decisions field. Both are clean follow-ups.

## 10. PR-by-PR status (live updates)

| PR | Topic | Status | PR # | Squash commit | Shipped |
|---|---|---|---|---|---|
| 1 | `<ClerkUserIdCell>` shared component | PR ready (Greptile + CodeRabbit review pending) | — | — | — |
| 2 | Resend invitation | pending | — | — | — |
| 3 | Onboarding status page `/onboarding/[id]` | pending | — | — | — |
| 4 | Questionnaire + work examples | pending | — | — | — |

Update this table as PRs ship. Mirror the live status line into `docs/plans/README.md`.

---

## Appendix A — Design decisions

### A.1 Clerk dashboard URL derivation — LOCKED

`getClerkDashboardUserUrl` derives the app ID from the publishable key via a single Clerk Backend API call (`clerkClient.instance.get()`) cached at module level. No new env var required in the happy path. Falls back gracefully (returns `null` → component renders copy button without dashboard link + console warning) if the API call fails.

### A.2 Resend button placement — LOCKED

`ResendInvitationButton` lives on the detail page (`/admin/onboardings/[id]`) next to the existing `RetryOnboardingButton`. This matches the convention across admin state-changing actions: they live on the detail page where the row's full context (status, timeline, attempt count) is visible. A list-row context-menu affordance would be premature for a per-row action that benefits from seeing the resource first; bulk resend is a separate follow-up.

### A.3 Onboarding completion flow (folded into §3.3)

The student-facing flow walk-through in §3.3 is the canonical description of how onboarding works after these PRs ship. This appendix slot is kept as a placeholder for any future flow questions that arise during implementation.

### A.4 Questionnaire canonicalisation — LOCKED: hybrid (canonical in code, capture question text per answer)

**The three questions for v1** (lives in `apps/platform/lib/onboarding-questions.ts` as a typed const):

1. **How did you learn about this mentorship?** — textarea, 2000 chars, required.
2. **What are your goals with art and this mentorship?** — textarea, 4000 chars, required.
3. **Who are your artistic inspirations?** — 3–4 entries, each with a single `name` field, required.

The original fourth question ("Anything else you'd like your instructor to know?") was dropped after a scope simplification — the three questions above are the minimal intake that informs the first mentorship call.

**Why hardcode in code (not DB templates) for v1:** the questions are general enough to apply across programs. We avoid the templates-table/UI/versioning arc. If per-program customization is ever needed, we can add a `questionnaireTemplates` table later without breaking old submissions.

**Why capture question text alongside each answer:** if the wording is reworded later, old submissions display the original wording above the student's answer — historically accurate for the instructor reviewing.

**Schema:**

```ts
onboardingQuestionnaireSubmissions: defineTable({
  onboardingId: v.id("adminOnboardings"),
  studentClerkId: v.string(),
  questionnaireVersion: v.number(),
  status: v.union(v.literal("draft"), v.literal("submitted")),
  answers: v.array(v.object({
    questionId: v.string(),
    questionText: v.string(),
    answerText: v.string(),
  })),
  inspirations: v.array(v.object({
    name: v.string(),                           // single field — no "why inspired"
  })),
  createdAt: v.number(),
  updatedAt: v.number(),                        // set on every auto-save; used by the cron
  submittedAt: v.optional(v.number()),
  lastReminderSentAt: v.optional(v.number()),
  reminderCount: v.optional(v.number()),
})
  .index("by_onboardingId", ["onboardingId"])
  .index("by_status_updatedAt", ["status", "updatedAt"])
```

`questionnaireVersion` is bumped whenever any question's label (what the student sees), type, or validation rule changes. Pure typo fixes and clarifying comments do not count.

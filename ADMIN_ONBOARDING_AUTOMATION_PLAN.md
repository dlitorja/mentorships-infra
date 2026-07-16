# Admin Onboarding Automation (Kajabi) — Plan

Status: PR 1, PR 2, and PR 3 merged to `main`. PR 4 (Greptile fix pass for all PR #636 review findings) PR opened at #637 — pending review/merge.

Source of truth for the work below; supersedes any informal discussion in chat.

## Goal

Extend the admin dashboard (`apps/platform`) with a Kajabi onboarding flow that mirrors the post-purchase onboarding experience without going through Stripe or PayPal. Admins enter a student email, select one or more instructors, and the system creates the student account, the per-instructor mentorship workspace(s), and sends notifications — all without a payment record.

The existing `purchase/mentorship` Inngest flow stays untouched. This is a parallel, payment-less path.

## Naming Guardrails (Critical)

Per `AGENTS.md`:

- Use `instructor` (never `mentor`) and `student` (never `mentee`) in code, comments, and route/file names.
- "mentorships" stays only in UI copy.

## Why Existing Pieces Fit

The codebase already has the exact primitives we need — we just skip the payment/order layer:

- **Auto-link on Clerk signup** — `apps/platform/inngest/functions/clerk-user-linking.ts:39` runs on `clerk/user.created` and rewrites any `sessionPacks.userId === "email:<normalized>"` rows to the new Clerk `userId`. We create records with that placeholder and they get claimed automatically.
- **`createSeatReservation`** — `convex/seatReservations.ts:352` already inserts a seat and a workspace in one mutation, with the seat linked to a session pack.
- **`createAdminSessionPack`** — `convex/sessionPacks.ts:246` is the existing pattern for payment-less admin-added packs.
- **`createStudentClerkInvitation`** — `lib/clerk-invitations.ts:75` sets `publicMetadata.role = "student"` and redirects to `/sign-up`.
- **Resend templates** — `RESEND_TEMPLATE_ID_PURCHASE_ONBOARDING`, `RESEND_TEMPLATE_ID_INSTRUCTOR_PURCHASE`, `RESEND_TEMPLATE_ID_ADMIN_PURCHASE` already exist; we extend them with an `isAdminOnboarded` flag rather than introducing new templates.

## Data Flow

The system uses an explicit state machine on `adminOnboardings`. Every transition is recorded as a timeline entry. All side effects are idempotent (find-then-create patterns) so Inngest retries are safe.

### Admin form (two-phase)

Phase 1 — Preview (no side effects):

```
Admin submits form
  └─ POST /api/admin/students/onboard/preview   (admin or support role required)
       └─ Convex query `previewAdminOnboarding`
            • Per-pair renewal detection (read-only).
            • Instructor capacity checks.
            • Existing-student / advanced-split banner content.
            • Returns structured preview:
              {
                email, instructors: [...], pairs: [
                  { instructorId, action: "new"|"renewal",
                    sessionCount, expiresAt, workspaceId?, seatReservationId? }
                ],
                conflicts: [...], warnings: [...],
                emailsToSend: { student: 1, instructors: N, admin: 1 },
                capacityOverrides: [{ instructorId, currentCount, max, requiresReason: true }],
              }
```

Phase 2 — Commit:

```
Admin clicks "Confirm and Send"
  └─ POST /api/admin/students/onboard   (admin or support role required)
       ├─ 1. Create `adminOnboardings` row with `status: "queued"`.
       ├─ 2. Per selected instructor:
       │      • If new: create placeholder session pack →
       │        create seat reservation (auto-creates workspace) →
       │        rename workspace → write audit log.
       │      • If renewal: reuse existing seat + workspace.
       ├─ 3. Patch `adminOnboardings.status = "processing"`.
       ├─ 4. Emit `admin/onboarding.completed` Inngest event.
       ├─ 5. Return `{ onboardingId, status: "processing", perInstructor: [...] }`.
```

### Inngest flow `adminOnboardingFlow`

Each step is idempotent. If Inngest retries a step, the step's effect is unchanged.

```
admin/onboarding.completed { onboardingId }
  └─ Step 1: load onboarding; bail if status != "processing".
  └─ Step 2: send student email (idempotent via `emailsSent.student`).
  └─ Step 3: per-instructor email loop (idempotent via `emailsSent.instructorIds`).
  └─ Step 4: admin summary email (idempotent via `emailsSent.admin`).
  └─ Step 5: per-instructor Discord DM enqueue
              (idempotent — re-enqueue with same payload is a no-op when status is already done).
  └─ Step 6: patch `status: "completed"` and append final timeline entry.
```

On any uncaught error in the flow:

```
• Inngest retries per flow retry policy.
• After max retries exceeded, the flow's catch handler:
    - patches `adminOnboardings.status = "failed"`,
    - patches `failureReason = <error message>`,
    - appends timeline entry `event: "failed"`,
    - sends one email to admins listing the failed onboarding + a link to the recovery dashboard.
• The onboarding does NOT auto-rollback; an admin must explicitly invoke
  `cancelAdminOnboarding` or `retryAdminOnboarding`.
```

### State transitions on `adminOnboardings`

```
queued ──► processing ──► completed
   │           │
   │           └──► failed ──► (retry) ──► processing
   │                       └────► cancelled
   └──► cancelled
```

`cancelled` and `failed` are terminal states. `retryAdminOnboarding` resets status to `processing` and re-emits the Inngest event (Inngest `idempotencyKey` includes the new attempt count to bypass any cached runs).

### Clerk sign-up side effects

```
When student accepts Clerk invite:
  └─ `clerk/user.created` → `linkClerkUserToSessionPacks`
       ├─ Rewrites session pack / seat / workspace userId to Clerk userId.
       └─ Mirrors rewrite to `discordActionQueue.subjectUserId` for matching placeholders.
```

### Daily stale-invite cleanup

```
Daily at 09:00 UTC:
  └─ Inngest scheduled flow `adminOnboardingStaleDigestFlow`
       ├─ Scan `studentInvitations` (`status: pending`, `expiresAt < now - 13d`,
       │   placeholder session pack still exists with no linked Clerk user).
       ├─ One batched email to all `ADMIN_EMAILS` with the stale invite list.
       └─ Release placeholder seat reservations; mark invitations `status: expired`;
           end workspaces via `endedAt`.
```

## Files To Touch

Create:

- `convex/adminOnboarding.ts` (queries + mutations)
- `apps/platform/inngest/functions/admin-onboarding.ts` (`adminOnboardingFlow` + `adminOnboardingStaleDigestFlow`)
- `apps/platform/lib/emails/admin-onboarding-student-email.ts`
- `apps/platform/lib/emails/admin-onboarding-instructor-email.ts`
- `apps/platform/lib/emails/admin-onboarding-admin-email.ts`
- `apps/platform/app/admin/onboardings/page.tsx` (failed-onboardings recovery dashboard)
- `apps/platform/app/admin/onboardings/[id]/page.tsx` (single onboarding detail with timeline + retry/cancel actions)
- `apps/platform/app/api/admin/students/onboard/preview/route.ts` (preview endpoint)
- `apps/platform/app/api/admin/students/onboard/route.ts` (commit endpoint)
- `apps/platform/app/api/admin/onboardings/[id]/retry/route.ts`
- `apps/platform/app/api/admin/onboardings/[id]/cancel/route.ts`
- `apps/platform/app/api/admin/onboardings/[id]/route.ts` (GET for status polling)

Modify:

- `convex/schema.ts` — add `adminOnboardings` table; widen `users.role` with `"support"`; add `users.onboardingAlias` (optional marker for the "advanced split" case); widen `workspaceAuditLogs` with `adminOnboardingId` for correlation.
- `apps/platform/app/admin/students/invite/page.tsx` — add the "Full onboarding (with workspace assignment)" mode + two-phase form (preview → confirm).
- `apps/platform/app/admin/client-admin-layout.tsx` — add `{ href: "/admin/onboardings", label: "Onboardings", icon: ListChecks }` to the sidebar (links to the recovery dashboard).
- `apps/platform/lib/auth-helpers.ts` — widen `UserRole` union with `"support"`; add `requireAdminOrSupportForApi`.
- `apps/platform/inngest/types.ts` — add `adminOnboardingCompletedEventSchema`, `adminOnboardingStaleDigestEventSchema`, `adminOnboardingRetryEventSchema`.
- `apps/platform/inngest/functions/clerk-user-linking.ts` — additive: rewrite `discordActionQueue.subjectUserId` from `email:<email>` placeholder to the new Clerk `userId` (mirrors the existing session-pack / seat rewrite pattern).
- `convex/discordActionQueue.ts` — add a small helper for the placeholder rewrite if needed.

## Routing

- **Extend `/admin/students/invite`** (not a new page). Add a mode toggle at the top of the form:
  - "Invitation only" → existing invitation flow, unchanged.
  - "Full onboarding (with workspace assignment)" → reveals Kajabi-specific fields below.
- **New sibling API route** at `apps/platform/app/api/admin/students/onboard/route.ts` so the existing `/api/admin/students/invite` POST is left untouched.
- **Two-phase API surface**:
  - `POST /api/admin/students/onboard/preview` → calls `previewAdminOnboarding`; zero side effects.
  - `POST /api/admin/students/onboard` → calls `adminOnboardStudent`; the commit.
- **New dashboard route**: `/admin/onboardings` for the recovery view (see Recovery Dashboard section).
- **New admin API routes** for the dashboard:
  - `GET /api/admin/onboardings/[id]` — single onboarding row (polled by detail page).
  - `POST /api/admin/onboardings/[id]/retry` — calls `retryAdminOnboarding`.
  - `POST /api/admin/onboardings/[id]/cancel` — calls `cancelAdminOnboarding`.

## Convex Schema Additions

All widen-only — no backfill required.

### New table: `adminOnboardings`

```ts
adminOnboardings: defineTable({
  // Identity
  email: v.string(),                                // normalized lowercase
  flowVersion: v.number(),                          // = 1 for v1; bump on schema/behavior changes
  source: v.union(
    v.literal("kajabi"),                            // primary source for this PR
    v.literal("manual"),                            // future: hand-entered admin actions
    v.literal("import"),                            // future: CSV / external platform import
    v.literal("api")                                // future: programmatic API
  ),

  // Selection
  instructorIds: v.array(v.id("instructors")),
  sessionsPerInstructor: v.number(),                // default 4, min 1
  expiresAt: v.optional(v.number()),                // per-instructor expiry (mirrored across pairs)
  isSeparateStudentRecord: v.boolean(),             // advanced split toggle
  onboardingAlias: v.optional(v.string()),          // mirrors users.onboardingAlias when split used
  capacityOverrideReason: v.optional(v.string()),   // required if any selected instructor is at capacity

  // Created artifacts
  sessionPackIds: v.array(v.id("sessionPacks")),
  seatReservationIds: v.array(v.id("seatReservations")),
  workspaceIds: v.array(v.id("workspaces")),        // newly created (not renewed) workspaces
  existingWorkspaceIds: v.array(v.id("workspaces")),// reused on renewal pairs
  clerkInvitationIds: v.array(v.string()),
  isRenewalAllPairs: v.boolean(),                   // true if every selected pair was a renewal

  // State machine
  status: v.union(
    v.literal("queued"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled")
  ),
  failureReason: v.optional(v.string()),             // last error message
  attemptCount: v.number(),                         // increments on each retry
  lastAttemptAt: v.optional(v.number()),

  // Per-recipient email receipts (for idempotency)
  emailsSent: v.object({
    student: v.boolean(),
    instructorIds: v.array(v.id("instructors")),    // which instructor emails succeeded
    admin: v.boolean(),
  }),

  // Human-readable event history (append-only)
  timeline: v.array(v.object({
    at: v.number(),
    event: v.string(),                              // e.g. "queued", "workspace_created", "student_email_sent", "failed"
    details: v.optional(v.string()),
    actorUserId: v.optional(v.string()),             // admin userId when applicable
  })),

  // Audit
  onboardedByUserId: v.string(),                    // admin's Clerk userId
  notes: v.optional(v.string()),                    // internal notes (required when split used or capacity overridden)
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
})
  .index("by_email", ["email"])
  .index("by_status", ["status"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_onboardedByUserId", ["onboardedByUserId"])
  .index("by_createdAt", ["createdAt"]),
```

### Widens

```ts
// convex/schema.ts — users.role
role: v.optional(v.union(
  v.literal("student"),
  v.literal("instructor"),
  v.literal("admin"),
  v.literal("video_editor"),
  v.literal("support"),                              // NEW
)),

// convex/schema.ts — users.onboardingAlias
onboardingAlias: v.optional(v.string()),             // NEW; marker for advanced-split records

// convex/schema.ts — workspaceAuditLogs (additive correlation field)
adminOnboardingId: v.optional(v.id("adminOnboardings")), // NEW; lets us correlate a workspace to its onboarding
```

The `details` field on `workspaceAuditLogs` remains a free-form string for human-readable rendering; `adminOnboardingId` is the structured field for programmatic queries and reporting.

## Idempotency Strategy

Every side effect is `find-then-create` so Inngest retries (and admin-initiated retries) are safe. The status of each side effect is recorded in `adminOnboardings.timeline` and `emailsSent`.

| Step | Idempotency mechanism |
|---|---|
| Clerk invitation | Clerk API itself; rejects duplicates with a known error. Record the returned `clerkInvitationId` on the onboarding row. |
| Placeholder session pack | Query by `(userId = "email:<email>", instructorId)`; if exists, reuse. |
| Seat reservation | `createSeatReservation` already errors on duplicates; check first via `seatReservations.by_sessionPackId`. |
| Workspace | Auto-created alongside seat; never duplicated because seat creation is idempotent. |
| Workspace name patch | `workspaces.updateWorkspace` is idempotent (same target name). |
| Student email | Guarded by `emailsSent.student`. If true, skip. |
| Per-instructor email | Guarded by `emailsSent.instructorIds` membership. If instructor already in list, skip. |
| Admin email | Guarded by `emailsSent.admin`. |
| Discord DM enqueue | `migrateDiscordAction` is idempotent on `subjectUserId`. |
| Audit log entry | Insert only when timeline lacks a matching `event` for the same pair. |

Retry semantics: an Inngest event with the same `id` is ignored. We use `attemptCount` + `lastAttemptAt` as the idempotency key when re-emitting, so retries bypass any cached runs.

## State Transitions

```
queued ──► processing ──► completed
   │           │
   │           ├──► failed ──► (retryAdminOnboarding) ──► processing
   │           │              └─► (cancelAdminOnboarding) ──► cancelled
   │           └──► cancelled
   └──► cancelled
```

Allowed transitions enforced by the mutations:

| From | To | Mutation |
|---|---|---|
| (none) | queued | `createAdminOnboarding` (form commit) |
| queued | processing | `markProcessing` (auto, after commit side effects) |
| processing | completed | auto, on Inngest flow success |
| processing | failed | auto, on Inngest flow failure (post-retries) |
| any (non-terminal) | cancelled | `cancelAdminOnboarding` |
| failed | processing | `retryAdminOnboarding` |
| cancelled | (terminal) | none |
| completed | (terminal) | none |

`queued → cancelled` is allowed (admin changes mind before commit completes). `processing → cancelled` is allowed mid-flight. `completed → cancelled` is rejected with an explicit error.

## `adminOnboardStudent` Mutation Spec

Args (validated by zod in the API route):

```ts
{
  email: string,                          // required, RFC 5322; normalized to lowercase
  instructorIds: Id<"instructors">[],     // >= 1; each must exist & not be soft-deleted
  sessionsPerInstructor: number,          // default 4; min 1
  expiresAt: number | undefined,          // optional; if set must be > now
  notes: string | undefined,              // required when isSeparateStudentRecord = true
  isSeparateStudentRecord: boolean,       // advanced toggle
  capacityOverrideReason: string | undefined, // required if any selected instructor is at capacity
}
```

Behavior (executed in a single transaction):

1. Validate inputs (admin or support role; each instructor exists, is active, not soft-deleted).
2. For each `instructorId`, per-pair renewal check:
   - Query `seatReservations` via `by_userId_instructorId` with `userId = "email:<email>"` and `instructorId = <id>`.
   - If an active or grace seat exists → `isRenewal = true` for that pair; reuse the seat and workspace; do **not** create a new pack/seat.
   - Otherwise → `isRenewal = false` for that pair; create a new placeholder session pack (`userId = "email:<email>"`, `paymentId: undefined`, `status: "active"`), then call `createSeatReservation` (auto-creates the workspace), then patch workspace name.
3. Per non-renewal workspace, insert a `workspaceAuditLogs` row with `action: "create_workspace"`, `adminOnboardingId: <id>`, and `details: "Auto-created via Kajabi admin onboarding by <adminUserId> | sessionPackId=… | seatReservationId=… | isRenewal=false | flowVersion=1"`.
4. Per renewed pair, no new audit entry (workspace already exists); record `existingWorkspaceIds` in the `adminOnboardings` row instead.
5. If `isSeparateStudentRecord = true`, create or update the Convex `users` row for this email with `onboardingAlias: <uuid>`, and tag the `adminOnboardings` row with the same alias. Clerk remains a single account.
6. Insert the `adminOnboardings` row with `status: "queued"`, `flowVersion: 1`, `source: "kajabi"`, an initial timeline entry `{ at: now, event: "queued", actorUserId: <admin> }`, and the `emailsSent` object zeroed out.
7. Patch `status: "processing"` and append timeline entry `{ event: "processing_started" }`.
8. Emit `admin/onboarding.completed` Inngest event with `{ onboardingId, attemptCount: 1 }`.
9. Return `{ onboardingId, status: "processing", perInstructor: [{ instructorId, workspaceId, seatReservationId, sessionPackId, isRenewal, clerkInvitationId }] }`.

## Companion mutations and queries

- **`previewAdminOnboarding`** (query, no side effects): runs the same per-pair renewal detection and capacity checks the commit mutation would run, but returns a structured preview object instead of writing. Mirrors the existing `dryRun: v.optional(v.boolean())` pattern from `convex/instructors.ts:137`. Returns the same shape the form renders in its preview step.
- **`retryAdminOnboarding`** (mutation, admin/support): resets `status: "processing"`, increments `attemptCount`, patches `lastAttemptAt`, appends timeline entry `{ event: "retrying", actorUserId: <admin> }`, re-emits `admin/onboarding.completed` Inngest event with the new attempt count as part of the idempotency key.
- **`cancelAdminOnboarding`** (mutation, admin/support): sets `status: "cancelled"`, `cancelledAt: now`, appends timeline entry `{ event: "cancelled", actorUserId: <admin> }`. Does **not** delete the existing session packs, seats, or workspaces — they stay as artifacts so the admin can see what was attempted. Future support tooling can offer a "delete orphaned onboarding artifacts" action; out of scope for v1.
- **`getAdminOnboarding`** (query): returns the full row for status polling.
- **`listAdminOnboardings`** (query): paginated listing for the recovery dashboard; filterable by `status` and `email`.
- **`getInstructorOptionsForOnboarding`** (query): returns active, non-deleted instructors with `{ id, name, email, oneOnOneInventory, groupInventory, maxActiveStudents, activeStudentCount }`. Powers the multi-select dropdown and surfaces capacity info.

## Form UX (added to `/admin/students/invite`)

Two-phase form: **Preview → Confirm**. Phase 1 makes zero side effects; Phase 2 commits.

Sections top-to-bottom:

1. **Mode toggle**: "Invitation only" | "Full onboarding (with workspace assignment)".
2. **Student email** (existing field).
3. When mode = full onboarding:
   - **Existing-student banner** (when `users.email` row exists or prior `adminOnboardings` rows exist for the email):
     - "An account already exists for this email — {{studentName}} ({{existingInstructorsList}})."
     - Default radio: "Use existing student" (Interpretation A).
   - **Advanced disclosure**: checkbox "Create a separate student record for this email (Convex-only split, does not create a new Clerk account)".
     - Reveals a confirmation modal that explains exactly what happens and asks for an admin note (required).
   - **Instructor multi-select** with capacity badge "X/Y active". Selecting an at-capacity instructor reveals an inline "Reason for capacity override" required field.
   - **Per-instructor row**: sessions count (default 4, editable), expiration (default +90 days from now, editable), existing-workspace indicator if the pair is detected as a renewal.
   - **Internal notes textarea** (required when advanced split is selected or capacity overridden).
4. **Preview button** (replaces "Submit"): triggers `previewAdminOnboarding` query.
5. **Preview panel**:
   - Per-pair row: instructor name, action ("New workspace" / "Renewal — existing workspace"), session count, expiration, existing workspace link if renewal.
   - Warnings section: capacity overrides, existing-student note, advanced split note, any instructor conflicts.
   - Email plan summary: "Will send 1 student email, N instructor emails, 1 admin email."
6. **Confirm and Send button** (appears only after preview; secondary action).
7. **Result panel** (after commit): per-instructor workspace links, Clerk invitation ID(s), Inngest event ID, current onboarding status with auto-refresh link to `/admin/onboardings/[id]`.

The two-phase pattern prevents accidental submissions, gives admins confidence, and matches the existing `dryRun` pattern in the codebase (`convex/instructors.ts:137`).

## Email Plan

Extend the three existing Resend templates with new optional variables (`isAdminOnboarded`, `isRenewal`, `instructorCount`). Do not introduce new Resend templates.

| Recipient | Subject | Notes |
|---|---|---|
| Student | `"Welcome — your mentorship with {{instructorName}} is ready"` (or `"Welcome back — your mentorship with {{instructorName}} is ready"` when every selected pair is a renewal) | Body lists every assigned instructor and each workspace link. |
| Instructor (per assigned instructor) | `"New student assigned — {{studentEmail}}"` (or `"Renewal — {{studentEmail}}"` when `isRenewal: true` for that pair) | Body includes student email, sessions count, expiration, workspace link, 48-hour reach-out reminder. |
| Admin | `"Kajabi onboarding — {{studentEmail}} × N instructors"` (one email per submission) | Body: full table of assignments + workspace links + notes + renewal flags + Clerk invitation IDs. Recipients: all `ADMIN_EMAILS`. |

When N > 1 instructors are selected:

- Student email lists each instructor and links to each workspace.
- One instructor email per instructor (each gets their own).
- Single admin summary email.

**Delivery receipts**: each send updates `adminOnboardings.emailsSent` and appends a `{ event: "email_sent", details: { recipient, templateId, resendMessageId } }` entry to `timeline` for auditability from the recovery dashboard.

## Renewal Semantics (Per-Pair, Not Whole-Email)

Detection: for each selected `instructorId`, query `seatReservations` via `by_userId_instructorId` with `userId = "email:<email>"`. If any active or grace row exists for that pair, the pair is a renewal.

Copy rules:

- **Student email subject**: "Welcome back" only if every selected pair is a renewal; otherwise "Welcome" — keeps per-pair semantics unambiguous.
- **Instructor email subject**: per-pair `isRenewal` independently controls renewal vs new copy.
- **Admin email**: shows `isRenewal` flag per row in the summary table.

## Workspace Naming (Auto)

After `createSeatReservation` returns, patch via `workspaces.updateWorkspace` to name = `"{{studentEmail}} × {{instructorName}}"`. Idempotent.

## Audit Logging

Use the existing `workspaceAuditLogs.action: "create_workspace"` (generic; matches `type: "mentorship"` workspaces). The `details` field carries source + key IDs for human-readable rendering. The new `adminOnboardingId` field carries the structured correlation for programmatic queries. We do **not** widen the action enum.

`details` shape:

```
"Auto-created via Kajabi admin onboarding by <adminUserId> | sessionPackId=<id> | seatReservationId=<id> | isRenewal=<bool> | flowVersion=1"
```

For renewed pairs: no new audit entry (the workspace already exists); the existing workspace is referenced from `adminOnboardings.existingWorkspaceIds` and correlated through `adminOnboardings.timeline`.

## Recovery Dashboard (`/admin/onboardings`)

New admin page (`apps/platform/app/admin/onboardings/page.tsx`) that lists onboardings by status. Linked from the sidebar (`client-admin-layout.tsx`).

Sections / tabs:

- **Needs attention** (`status: failed`) — primary support surface; shows failure reason, retry button per row.
- **Pending student signup** (`status: completed` AND no linked Clerk user for the placeholder email yet) — shows age in days; auto-flips to the stale digest section when older than 13 days.
- **In progress** (`status: queued | processing`) — shows current step from the latest `timeline` entry.
- **Completed** (`status: completed`) — paginated history with search by email/instructor.
- **Cancelled** (`status: cancelled`) — preserved for audit; per-row "view artifacts" link.

Per-row actions: View detail, Retry (calls `retryAdminOnboarding`), Cancel (calls `cancelAdminOnboarding`).

Detail page (`/admin/onboardings/[id]`) renders the full `timeline` as a chronological event log, the per-pair assignments, the email receipts, and the linked workspaces.

Status polling for the detail page: a GET endpoint at `/api/admin/onboardings/[id]` returns the current row; the UI polls every 2 seconds while `status ∈ {queued, processing}`. This is the v1 progress indicator; future enhancement could use Inngest realtime for instant updates.

## Cleanup Task (Inngest, not Trigger.dev)

New Inngest scheduled flow `adminOnboardingStaleDigestFlow`, runs daily at 09:00 UTC. Implementation in `apps/platform/inngest/functions/admin-onboarding.ts` alongside the main flow. New event `admin/onboarding.stale-digest` defined in `inngest/types.ts`.

Steps:

1. Scan `studentInvitations` where `status: "pending"` AND `expiresAt < now - 13 days` AND a placeholder `sessionPacks` row still exists for the email with `userId = "email:<email>"` (no linked Clerk user).
2. One batched email per day to all addresses in `ADMIN_EMAILS` listing each stale invite (email, invited instructors, days pending, suggested action).
3. After sending the digest:
   - Mark each matching `studentInvitations` row `status: "expired"`.
   - Mark each matching placeholder `seatReservations` row `status: "released"`.
   - Set the linked `workspaces.endedAt = now`.
4. Patch each related `adminOnboardings` row with `releasedAt` (small additive field on the table).

## Authorization

- New API route accepts `admin` **or** future `support` role via new helper `requireAdminOrSupportForApi`.
- `lib/auth-helpers.ts` widens `UserRole` union to include `"support"`.
- Convex `users.role` widens correspondingly.
- Clerk invitation for `support` users is out of scope; we just leave the type system ready.

## What Each User Type Sees (Edge Cases Accounted For)

Student:

- Clerk sign-up email with one-time CTA.
- After sign-up: `/dashboard` lists every assigned instructor and every workspace.
- Each workspace shows: instructor name + photo, sessions remaining, expiration date.
- Discord connect prompt (matches the existing purchase-onboarding copy).

Instructor (one email per assigned instructor):

- New: student email + sessions count + workspace link + "reach out within 48 hours".
- Renewal: subject + body reflect renewal; existing workspace link reused.
- Instructor dashboard: student appears in active students list immediately (linked via seat reservation + workspace on sign-up).
- Discord DM via `dm_instructor_new_signup` queue (enqueued with placeholder subjectUserId; rewritten when student signs up).

Admin:

- One summary email per submission with the full table.
- Student shows up in `/admin/students` and in the instructor's expanded students list on `/admin` dashboard.
- Workspaces appear in `/admin/workspaces` (type = "mentorship").
- `workspaceAuditLogs` entry on each new workspace (action `"create_workspace"` with the structured `details` above and `adminOnboardingId` for correlation).
- `adminOnboardings` record for history, idempotency, and the recovery dashboard.
- New `/admin/onboardings` page lists every onboarding submission by status; failed and stale rows surface as action items.

Failure modes accounted for:

- Clerk invitation already exists for this email → surface "already invited" error, do not duplicate DB rows.
- Instructor at capacity → warn but allow (admin override).
- Email already has a `users` row (existing student) → banner; default to "Use existing student" with advanced split toggle available.
- Email already has an active session pack with the selected instructor → renewal path; no double seat or workspace.
- Resend not configured → emails fail gracefully (returns `skipped: true`); admin still sees successful DB records.
- Inngest event send fails → API still returns success if DB succeeded; admin UI shows partial-success warning.
- Student never accepts the Clerk invite within 14 days → stale-digest flow notifies admins and releases the placeholder seat reservations.

## Decisions Locked

| # | Decision | Choice |
|---|---|---|
| 1 | Route | Extend `/admin/students/invite` (sibling API route at `/api/admin/students/onboard`). |
| 2 | Sessions | Default 4, admin-editable per instructor. |
| 3 | Validity | Default 90 days, admin-editable per instructor. |
| 4 | Emails | Async via Inngest (`admin/onboarding.completed` event). |
| 5 | Audit action | Reuse existing `"create_workspace"` action; `details` field carries source. |
| 6 | Discord | Enqueue `dm_instructor_new_signup` per instructor; placeholder subjectUserId rewritten on sign-up. |
| 7 | Order/payment | Skip entirely. Rely on `adminOnboardings` for audit. |
| 8 | Renewal copy | Per-pair only. Student subject uses "Welcome back" only if all selected pairs are renewals. |
| 9 | Workspace name | Auto: `"{{studentEmail}} × {{instructorName}}"`. |
| 10 | Admin email | One summary email per submission. |
| 11 | Stale invites | Inngest daily batched digest to admins + release placeholder seats. |
| 12 | Resend templates | Extend existing templates with new optional variables (`isAdminOnboarded`, `isRenewal`, `instructorCount`). |
| 13 | Future support role | Widen `UserRole` union, `users.role`, add `requireAdminOrSupportForApi`. Clerk invitation for support users out of scope. |
| 14 | Multi-instructor model | One workspace per `(student, instructor)` pair. |
| 15 | Existing email handling | Default "Use existing student" (Interpretation A); advanced toggle "Create a separate student record" (Interpretation C) creates a new Convex `users` row with `onboardingAlias` marker. Clerk remains a single account. |
| Cleanup impl | Trigger.dev vs Inngest | **Inngest** (consistency with the existing email flow). |
| 16 | State machine | Explicit `status` enum on `adminOnboardings` with allowed transitions; `cancel` and `retry` mutations. No distributed rollback. |
| 17 | Idempotency | Every side effect is find-then-create; receipts stored on the onboarding row. Inngest retries are safe. |
| 18 | Form phases | Two-phase: Preview (no side effects) → Confirm (commit). Mirrors the existing `dryRun` pattern from `convex/instructors.ts:137`. |
| 19 | Capacity override | Required reason field (captured in `capacityOverrideReason`) when any selected instructor is at capacity. |
| 20 | Flow versioning | `flowVersion: v.number() = 1` on `adminOnboardings`; bump on schema/behavior changes. |
| 21 | Audit correlation | New `workspaceAuditLogs.adminOnboardingId` field for programmatic joins; `details` stays as the human-readable string. |
| 22 | Source tagging | `source` enum (`kajabi` \| `manual` \| `import` \| `api`) so future onboarding channels (CSV import, programmatic API, etc.) share the same flow without schema migrations. |
| 23 | Timeline | `adminOnboardings.timeline` is the canonical event history; rendered in the recovery dashboard detail page. |
| 24 | Recovery dashboard | New `/admin/onboardings` page with Needs attention / Pending signup / In progress / Completed / Cancelled sections; per-row retry/cancel actions. |

## Verification Plan (When We Execute)

- `pnpm lint` and `pnpm typecheck` clean.
- Greptile review per `AGENTS.md` before any PR.
- Playwright smoke for the new form mode (extend `tests/e2e/` with a new spec; mirror existing TEST_WEBHOOK_BYPASS-style test bypass if needed for Clerk invitation mocking).
- Unit tests for:
  - Per-pair renewal detection across mixed renew + new submissions.
  - Idempotency lookup by `(email, instructorIds)` returns the same `adminOnboardingId` on repeated commits.
  - Expiration defaulting math.
  - Advanced split toggle behavior; advanced split blocks submit until notes are provided.
  - Capacity override requires reason; submit blocks without it.
  - `discordActionQueue` placeholder rewrite.
  - State transitions: `queued → processing → completed | failed | cancelled`; illegal transitions rejected.
  - `retryAdminOnboarding` increments `attemptCount` and re-emits Inngest event with new attempt in idempotency key.
  - `cancelAdminOnboarding` preserves artifacts and writes `cancelled` timeline entry.
  - `timeline` appends are append-only (no mutations).
- Manual verification checklist:
  - New student email with workspace links.
  - Renewal copy for one instructor + new copy for another in the same submission.
  - Advanced split creates new Convex row with `onboardingAlias`; existing `users.email` row untouched.
  - Admin summary email table renders correctly for N=1, N=2, N=3 instructor submissions.
  - Stale digest email fires at the scheduled time with the expected content.
  - Recovery dashboard: failed onboardings appear under "Needs attention"; Retry succeeds and the row moves to "In progress" then "Completed".
  - Two-phase form: Preview shows zero new rows; Confirm creates the expected rows; cancelling the preview does not write anything.

## Future / Out of Scope (Not in v1)

These were surfaced during planning but deliberately deferred. Track them as separate work items.

- **Notification abstraction layer** — refactor the email + Discord (and future Slack / SMS / in-app) calls into a `notifications.enqueue(recipient, channel, payload)` helper so adding a channel doesn't touch onboarding logic. Separate PR.
- **Bulk CSV onboarding** — design the pipeline so a future CSV import can stream rows through the same `adminOnboardStudent` mutation. Currently scoped to single submissions per the original user request.
- **Inngest realtime progress UI** — replace the v1 polling on `timeline` with `useRealtimeRun` once Inngest realtime is wired up in the platform.
- **Automated post-onboarding lifecycle subscribers** — once the onboarding flow is durable, add lightweight Inngest subscribers that fire on `admin/onboarding.completed` to: auto-create the student's first assignment checklist, queue a 48-hour instructor outreach reminder, queue a "schedule your first session" reminder if no session is booked after N days, notify admins on inactivity, sync the student into the CRM lifecycle sequence.
- **"Design for tens of thousands" platform review** — separate exercise to identify scaling pain points (Convex limits, query hotspots, Inngest concurrency, email throughput) and refactor accordingly.

## Pre-Implementation Reads (Confirm During Execution)

Before writing any code:

1. The exact `Inngest` scheduled-task pattern used elsewhere in `apps/platform` (look at `convex/crons.ts` and any existing `inngest.createScheduledFunction` usage) — mirror the existing pattern.
2. The exact Resend template variable names for the existing `RESEND_TEMPLATE_ID_PURCHASE_ONBOARDING` / `RESEND_TEMPLATE_ID_INSTRUCTOR_PURCHASE` / `RESEND_TEMPLATE_ID_ADMIN_PURCHASE` — extend the existing templates with new optional variables rather than creating new templates.
3. The existing `dryRun` pattern in `convex/instructors.ts:137` is the reference for the preview query design — copy the response-shape conventions.

## Implementation Plan (PR Sequencing)

The work is split into three independent PRs. Each lands on a branch off `main`, gets Greptile local-CLI review before push, and runs the project's existing lint/typecheck before opening the cloud PR. PRs are sequenced so each is independently shippable and rollback-safe; PR 2 depends on PR 1's schema and mutations; PR 3 depends on PR 1's mutations and PR 2's API surface.

### PR 1 — Schema + Mutations + Recovery Dashboard Scaffold — SHIPPED

**Goal**: land the data model, the three core mutations, the preview query, and the read-only recovery dashboard. Zero email sends, zero Inngest events; only DB writes.

**Status**: ✅ Merged to `main` (squash). Branch `feat/admin-onboarding-pr1-schema-mutations-dashboard`. PR #634.

**Files delivered (matches plan)**

- `convex/schema.ts` — added `adminOnboardings` table (status union, timeline, source union, flowVersion, attemptCount, perInstructor, isSeparateStudentRecord, onboardingAlias, capacityOverrideReason, existingWorkspaceIds, emailsSent, cancelledAt/cancelledByUserId, completedAt); indexes `by_email`, `by_status`, `by_status_createdAt`, `by_submittedByUserId`, `by_onboardingAlias`, `by_email_source`. Widened `users.role` with `"support"`. Added `users.onboardingAlias` + `by_onboardingAlias` index. Added `workspaceAuditLogs.adminOnboardingId` + `by_adminOnboardingId` index.
- `convex/adminOnboarding.ts` (new) — `previewAdminOnboarding` query, `adminOnboardStudent` mutation (calls internal `performCommit`), `retryAdminOnboarding`, `cancelAdminOnboarding`, `getAdminOnboarding`, `listAdminOnboardings`, `getInstructorOptionsForOnboarding`, `appendTimelineEntry` (internal mutation, used as the seam by PR 3). Helpers: `detectRenewal` (looks up by placeholder AND Clerk userId), `getActiveStudentCount`, `isAdminOrSupport`, `isInstructorActive`, `isValidEmail`, `normalizeEmail`, `generateAlias`, `isAllowedTransition`.
- `apps/platform/lib/admin-onboarding.ts` (new) — pure helpers shared by client + server: `ALLOWED_TRANSITIONS`, `isAllowedTransition`, `normalizeEmail`, `isValidEmail`, `validateCommitInput`, `statusLabel`, `timelineEventLabel`, `OnboardingStatus` + `TimelineEvent` types. Mirrors `convex/adminOnboarding.ts` so the form and the server agree on labels and transitions.
- `apps/platform/lib/admin-onboarding.test.ts` (new) — 22 vitest tests covering state machine + email utilities + validation + labels.
- `apps/platform/lib/queries/convex/use-admin-onboardings.ts` (new) — `useListAdminOnboardings`, `useAdminOnboarding` hooks + `AdminOnboarding` / `AdminOnboardingListItem` / `AdminOnboardingPerInstructor` / `AdminOnboardingTimelineEntry` types.
- `apps/platform/lib/auth-helpers.ts` — added `requireAdminOrSupportForApi`; widened `UserRole` with `"support"`; added `KNOWN_ROLES` + `isKnownRole`.
- `apps/platform/lib/queries/convex/use-users.ts` — widened `CurrentUser.role` union.
- `apps/platform/app/admin/onboardings/page.tsx` (new) — read-only list with 5 status tabs (Needs attention / Pending signup / In progress / Completed / Cancelled), email substring filter, 2 s auto-poll while `processing`.
- `apps/platform/app/admin/onboardings/[id]/page.tsx` (new) — read-only detail page; summary, per-instructor assignments, reverse-chronological `timeline`, capacity-override banner, notes, failure reason; explicit "not found" state for stale detail links.
- `apps/platform/app/admin/client-admin-layout.tsx` — added `ListChecks` "Onboardings" sidebar entry.
- `apps/platform/components/workspace/chat.tsx` + `images.tsx` + `resources.tsx` — widened `role` prop from `'student'|'instructor'|'admin'` to `UserRole` so the wider role union typechecks end-to-end. No behavioral change.

**Additional hardening folded in during review**

- `convex/adminOnboarding.ts` — `detectRenewal` extended to look up by Clerk userId from `users.email` row in addition to the `email:<email>` placeholder. Without this, a follow-up admin onboarding for a student who has already signed up would miss the existing seat and create duplicate enrollment artifacts (Greptile finding).
- `convex/adminOnboarding.ts` — `appendTimelineEntry` now caps `timeline` at 50 entries (trim oldest) to defend against runaway retry loops growing the document past 1 MB.
- `apps/platform/lib/queries/convex/use-admin-onboardings.ts` — `useAdminOnboarding` returns the full `AdminOnboarding` shape (not the trimmed `ListItem`) so the detail page sees `timeline` / `notes` / `capacityOverrideReason` cleanly under both `tsc --skipLibCheck` and Vercel's full Next.js typecheck.

**Verification (all green)**

```
typecheck:  clean (tsc --noEmit)
lint:       0 errors (135 pre-existing warnings, all in apps/web, untouched)
tests:      95 passed | 3 skipped (22 new from admin-onboarding.test.ts)
codegen:    npx convex codegen --typecheck enable  — OK
vercel:     mentorships-infra-platform + mentorships-infra + mentorships-infra-huckleberry-drive + mentorships-infra-web all Ready on re-deploy
```

**Greptile findings — disposition**

| # | Finding | Disposition |
|---|---------|-------------|
| a | Workspace owner stays as `email:<email>` placeholder after Clerk sign-up | Documented as pre-existing codebase limitation (`linkClerkUserToSessionPacks` only rewrites `sessionPacks` + `seatReservations`, not `workspaces.ownerId`). Not unique to PR 1; tracked as follow-up. |
| b | Per-pair renewal detection misses Clerk-signed-up students | Fixed in `detectRenewal` (see above). |
| c | Support users cannot reach `/admin/onboardings` | Parent layout (`apps/platform/app/admin/layout.tsx:11`) only accepts `"admin"`. Per `apps/platform/AGENTS.md` Clerk policy, modifying Clerk-provider wiring requires explicit user approval — flagged but not changed in PR 1. |
| d | Stale detail links leave the page in a permanent loading state | Fixed: detail page now distinguishes `isLoading` / `error` / `isMissing` (`data === null && !isLoading`) and renders an explicit "Not found / deleted" panel. |

**Vercel deployment failure — root cause and fix**

The first push at commit `d35dbbe` failed Next.js build for both `apps/platform` projects with:

```
./app/admin/onboardings/[id]/page.tsx:160:21
Type error: Property 'capacityOverrideReason' does not exist on type 'AdminOnboardingListItem'.
```

`tsc --skipLibCheck` (run locally) does NOT report this because the missing fields are unused, but Vercel's `next build` runs the project's `tsc --noEmit` first and rejects the build. Root cause was that `useAdminOnboarding` previously returned the slim `AdminOnboardingListItem` shape (a `Pick<>`), while the detail page needed `timeline`, `notes`, `capacityOverrideReason`. Fix at `2606cb52` widened the hook to `AdminOnboarding | null` and added the missing fields to the full type. Re-deploy of all 4 affected Vercel projects succeeded after the fix.

**Rollback**: drop the `adminOnboardings` table; no production user data is touched because PR 1 has no email/Inngest side effects.

**Squashed merge**: 12 files, +2334/-16 lines → single commit `feat(platform): admin onboarding schema + recovery dashboard (PR 1/3)` on `main`, with the review-fix commit `fix(platform): address PR #634 review feedback` squashed into the same branch.

### PR 2 — API Route + Form (Preview/Confirm) — SHIPPED

**Goal**: extend `/admin/students/invite` with the mode toggle and two-phase form; expose the sibling API routes; wire the retry/cancel admin endpoints. The Inngest event is emitted but consumed by a `mark-completed-stub` handler in PR 2 — replaced fully by PR 3.

**Status**: ✅ Merged to `main` (squash). Branch `feat/admin-onboarding-pr2-api-form`. PR #635.

**Files delivered (matches plan)**

- `apps/platform/app/admin/students/invite/page.tsx` — mode toggle ("Invitation only" | "Full onboarding (with workspace assignment)"), existing-student banner, advanced disclosure + confirmation modal, capacity-override reason field, internal notes textarea, two-phase Preview → Confirm flow, `FILTER_TO_TITLE` map for `PendingInvitationsCard`. Copy uses `instructor workspaces` (not `mentor workspaces`); `mentorships` retained only in the card title.
- `apps/platform/components/admin/admin-onboarding-form.tsx` (new) — the two-phase form component: 350 ms debounced `useDebouncedValue` for the existing-student lookup, a draft fingerprint (`useMemo` over sorted `instructorIds` + flags) that invalidates the preview via `useEffect` + `prevFingerprintRef` on any change, `PreviewResponse`/`CommitResponse` Zod schemas for response validation (`commitResponseSchema.status = "processing" | "failed"` + optional `failureReason?`), `CommitResultPanel` that renders an amber failure card when status is `failed`, `canCommit` honors server flags `capacityOverrideRequired` + `notesRequired`, `canPreview` includes `!commitResult` to prevent re-preview after commit.
- `apps/platform/app/api/admin/students/onboard/preview/route.ts` (new) — POST; calls `previewAdminOnboarding`; zero side effects; admin/support role required; `convexIdSchema` validates every `instructorIds` entry; reads body via shared `readJsonBody` (returns 400 on parse failure).
- `apps/platform/app/api/admin/students/onboard/route.ts` (new) — POST; calls `adminOnboardStudent`; zod validation; issues ONE Clerk invitation per email and fans the ID across non-renewal pairs (Clerk allows one pending invitation per email); emits `admin/onboarding.completed` Inngest event; guards `NEXT_PUBLIC_APP_URL` (throws early if absent so the Clerk redirect URL does not evaluate to `"undefined/sign-up"`); on Clerk or Inngest failure, calls `markOnboardingFailed` with detail, sets `responseStatus = "failed"` + `failureReason`, returns the actual row status (not always `"processing"`); `markOnboardingFailed` does NOT require a Clerk session because the action is gated only by `CONVEX_SERVER_SHARED_SECRET`; `reportError` logs use `fingerprint(email)` so PII is redacted.
- `apps/platform/app/api/admin/onboardings/[id]/route.ts` (new) — GET; validates `id` with `convexIdSchema` → 400 on malformed; returns the current row (polling target); explicit `Promise<NextResponse>` return type.
- `apps/platform/app/api/admin/onboardings/[id]/retry/route.ts` (new) — POST; validates `id`; calls `retryAdminOnboarding`; explicit `Promise<NextResponse>` return type; mirrors `markOnboardingFailed` recovery (sets `responseStatus = "failed" | "processing"` + `failureReason?`).
- `apps/platform/app/api/admin/onboardings/[id]/cancel/route.ts` (new) — POST; validates `id`; calls `cancelAdminOnboarding`; explicit `Promise<NextResponse>` return type.
- `apps/platform/inngest/functions/onboarding.ts` — added stub `adminOnboardingFlow` handler with `retries: 2`. Loads the onboarding row via `api.adminOnboarding.getAdminOnboardingAction` (public action, shared-secret gated; Inngest worker has no Clerk session). Bails if `status !== "processing"`. Malformed event payload + missing `CONVEX_SERVER_SHARED_SECRET` throw `NonRetriableError` (permanent failures so `retries: 2` does not burn cycles). Both `appendTimelineEntryAction` calls pass `expectedStatus: "processing"` + `expectedAttemptCount` for an atomic stale-arrival guard. The stub marks the row `failed` if every non-renewal pair lacks a `clerkInvitationId` (would silently succeed otherwise). Result is captured as a `StepResult` and propagated into the outer return `{ success: !stepResult.failed, reason? }`.
- `apps/platform/inngest/types.ts` — added `adminOnboardingCompletedEventSchema` (uses `convexIdSchema` for `onboardingId`).
- `apps/platform/inngest/client.ts` — no edits (shared `inngest` client reused).
- `apps/platform/app/api/inngest/route.ts` — registered `adminOnboardingFlow`.
- `apps/platform/lib/queries/convex/use-admin-onboardings.ts` — added `useInstructorOptionsForOnboarding` + `useLookupExistingStudent` (accepts `undefined`).
- `apps/platform/lib/api/read-json-body.ts` (new) — shared safe JSON body parser (`route.ts` helper; returns 400 with error message on parse failure; reused by preview + commit routes).
- `apps/platform/lib/log-fingerprint.ts` (new) — FNV-1a hash of email for stable, PII-free observability (`fingerprint(email) → fp_<16hex>`); used by the commit route's `reportError` calls.
- `tests/e2e/admin-onboarding.spec.ts` (new) — Playwright smoke for the two-phase form (regex-matcher for the commit endpoint, single consolidated `page.route("/api/convex", ...)` mock for the existing-student lookup).

**Convex changes (`convex/adminOnboarding.ts`)**

- `adminOnboardStudent` accepts `clerkInvitationIds?: Record<Id<"instructors">, string>` — only non-renewal pairs carry an ID; renewed pairs reuse the existing Clerk invitation from the prior onboarding.
- `performCommit` (internal) consumes the same arg; writes `clerkInvitationIds` onto per-instructor rows.
- `lookupExistingStudent` query (admin/support gated) — powers the form's existing-student banner.
- `appendTimelineEntry` is `internalMutation` with optional `expectedStatus?: string` + `expectedAttemptCount?: number` — rejects mismatch atomically (stale-arrival guard against Inngest retries landing on a row that has already moved).
- Public `appendTimelineEntryAction` (shared-secret gated) forwards `expectedStatus` / `expectedAttemptCount` — the seam PR 3 will use for every "step done" timeline write.
- `getAdminOnboardingInternal` (`internalQuery`) + public `getAdminOnboardingAction` (`action`, shared-secret gated) — used by the Inngest stub (no Clerk session in Inngest worker).
- Imports extended: `internalQuery, action` from `./_generated/server`.

**Additional hardening folded in during review**

- **Secret bypass on a public query → public action**: Greptile P1 flagged that a public `query` with a `secret` arg is bypassable by anyone reading the generated API spec. Moved the shared-secret check behind a public `action` (`appendTimelineEntryAction` + `getAdminOnboardingAction`) that delegates to an `internalQuery`/`internalMutation` unreachable from the browser. This is the same pattern used by `linkSessionPacksByEmailAction` (`convex/sessionPacks.ts:626`).
- **`markOnboardingFailed` must not require a Clerk JWT**: the Inngest worker / non-browser paths that need to flip a row to `failed` have no Clerk session; gating the action on the Clerk `requireAdminOrSupportForApi` would silently abort recovery. Auth is `CONVEX_SERVER_SHARED_SECRET` only.
- **API responses must reflect the actual row status after recovery**: the first iteration always returned `status: "processing"`; on a failed `markOnboardingFailed` recovery that misled `CommitResultPanel` until the Convex subscription caught up. Fixed to set `responseStatus = "failed"` + `failureReason?` when recovery was triggered.
- **Inngest stub must propagate step results**: `step.run("mark-completed-stub")` return value flows into the outer return so `failed` reasons are observable in the Inngest dashboard and `adminOnboardings.timeline`.
- **`NEXT_PUBLIC_APP_URL` is required**: the Clerk redirect URL would silently become `"undefined/sign-up"` if the env var were missing; guard throws early.
- **Path `id` params validated with `convexIdSchema`**: replaced `as any` casts with `as Id<"instructors">` / `as Id<"adminOnboardings">`; malformed IDs → 400.
- **PII in `reportError`**: replaced raw `email` with `fingerprint(email)` so observability cannot leak PII through structured logs.
- **Mandatory writes do not silently abort on stale rows**: the `expectedStatus` + `expectedAttemptCount` guard on `appendTimelineEntry` ensures a retry arriving after the row already advanced does not double-write or corrupt timeline order.

**Greptile findings — disposition**

| # | Finding | Disposition |
|---|---------|-------------|
| a | Public `query` checks shared secret (bypassable from browser) | Fixed: moved to public `action` → `internalQuery`/`internalMutation`. |
| b | `markOnboardingFailed` would silently abort without Clerk JWT | Fixed: action gated on `CONVEX_SERVER_SHARED_SECRET` only. |
| c | API always returned `status: "processing"` even after recovery | Fixed: reflects actual row status (`"failed"` + `failureReason?`). |
| d | Inngest stub swallow step results | Fixed: `StepResult` propagated into outer return `{ success, reason? }`. |
| e | `NEXT_PUBLIC_APP_URL` not validated before building Clerk redirect URL | Fixed: throws early if absent. |
| f | `as any` casts in `[id]` routes | Fixed: `as Id<"adminOnboardings">` after `convexIdSchema` validation; 400 on malformed IDs. |
| g | Raw `email` in `reportError` is PII | Fixed: replaced with `fingerprint(email)` via shared helper. |
| h | Stale-arrival guard on `appendTimelineEntry` missing | Fixed: optional `expectedStatus` + `expectedAttemptCount` atomic reject. |
| i | Inngest stub on malformed event retries forever | Fixed: `NonRetriableError` on malformed event + missing shared secret. |
| j | `getAdminOnboardingAction` annotation causes circular inference | Accepted: `ReturnType<typeof action>` annotation needed to break cycle; removing it breaks `npx convex codegen --typecheck enable`. Cosmetic only. |
| k | `load-onboarding` query disabled with empty ID | Cosmetic: harmless on disabled branch; left as-is. |

**Verification (all green on `9349892f`)**

```
codegen:    npx convex codegen --typecheck enable  — OK
typecheck:  NODE_OPTIONS='--max-old-space-size=8192' pnpm typecheck  — 0 errors / 135 pre-existing warnings
lint:       pnpm lint  — 0 errors / 135 warnings (unchanged)
tests:      pnpm test:unit --run  — 95 passed | 3 skipped (no new unit tests; e2e covers new flow)
build:      cd apps/platform && pnpm build  — ✓ Compiled successfully
ci:         convex-codegen + Detect Changes + typecheck-convex + Lint & Type Check + typecheck-apps + Unit Tests + build-apps + E2E Tests + Build + Vercel Preview Comments — all SUCCESS
greptile:   local CLI reported "Safe to merge", 0 inline comments after 4 iterations
vercel:     mentorships-infra-platform + mentorships-infra + mentorships-infra-huckleberry-drive + mentorships-infra-web all Ready
```

**Rollback**: revert the new API routes and form section; restore the old `/admin/students/invite` page. The mutations and schema from PR 1 are unaffected.

**Squashed merge**: 15 files, +2461/-146 lines → single commit `feat(platform): admin onboarding two-phase form + API routes (PR 2/3)` on `main` (merge commit `720a6beb`), with the review-fix commit `fix(platform): address PR #635 review findings for admin onboarding` squashed into the same branch.

### PR 3 — Inngest Flow + Resend + Daily Digest — SHIPPED (PR #636, merged `618a239b`)

**Goal**: replace the PR 2 stub with the real Inngest handler; extend Resend templates; enqueue Discord DMs; wire the daily stale-digest cron.

**Scope (high-level)**

- Real `adminOnboardingFlow` steps: load → student email → per-instructor email loop → admin summary email → per-instructor Discord DM enqueue → final `status: "completed"` + timeline.
- On uncaught error: `status: "failed"` + `failureReason` + admin digest email.
- New `adminOnboardingStaleDigestFlow` (daily 09:00 UTC).
- Extend existing Resend templates with `isAdminOnboarded`, `isRenewal`, `instructorCount` variables (no new templates).
- Verify that `clerk/user.created` already rewrites `discordActionQueue.subjectUserId` for admin-onboarded placeholders (no code change expected; verification step only).

**Files**

- `apps/platform/inngest/functions/onboarding.ts` — replace the PR 2 stub `adminOnboardingFlow` body with the real handler. Keep the existing scaffolding: load-onboarding via `api.adminOnboarding.getAdminOnboardingAction` (shared secret), bail-if-not-processing check, `NonRetriableError` on malformed events, atomic `expectedStatus: "processing"` + `expectedAttemptCount` writes via `api.adminOnboarding.appendTimelineEntryAction`. Replace `step.run("mark-completed-stub")` with: `step.run("send-student-email")`, `step.run("send-instructor-emails")` (single step that fans per instructor and tracks `emailsSent.instructorIds`), `step.run("send-admin-email")`, `step.run("enqueue-discord-dms")` (single step that enqueues `dm_instructor_new_signup` per instructor with `subjectUserId: "email:<email>"`), `step.run("mark-completed")`. Catch handler: `status: "failed"` + `failureReason` + timeline + admin digest.
- `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts` (new) — `inngest.createFunction` with cron `0 9 * * *` (09:00 UTC daily). Scan `adminOnboardings` where `status: "completed"` AND placeholder session pack still exists (`userId = "email:<email>"`) AND `createdAt < now - 13 days`. Send one batched digest email to all `ADMIN_EMAILS` listing each stale invite (email, invited instructors, days pending, suggested action). On send success: mark matched `studentInvitations.status = "expired"` (if column exists; otherwise skip), release placeholder `seatReservations.status = "released"`, set `workspaces.endedAt = now`, add a `releasedAt` field to the matched `adminOnboardings` row via `appendTimelineEntryAction` with `event: "released"`.
- `apps/platform/inngest/types.ts` — add `adminOnboardingStaleDigestEventSchema` (no payload; the function reads DB state directly). Verify `adminOnboardingCompletedEventSchema` already supports PR 3's payload (no change expected).
- `apps/platform/inngest/functions/clerk-user-linking.ts` — no edits; existing handler already rewrites `discordActionQueue.subjectUserId`. Add a verification-only grep + test that exercises the placeholder rewrite for admin-onboarded records (manual review checklist item).
- `packages/emails/src/send.ts` — confirm optional `variables` pass-through; no signature change expected.
- `apps/platform/lib/emails/purchase-onboarding-email.ts`, `instructor-onboarding-email.ts`, `admin-purchase-notification-email.ts` — extend renderers to accept and surface the new optional vars (`isAdminOnboarded`, `isRenewal`, `instructorCount`).
- `convex/discordActionQueue.ts` — confirm the placeholder-subjectId flow works with admin-onboarded records; add a small helper if the existing `migrateDiscordAction` does not cover the case (probably not needed; verification step only).

**Inngest flow step shape (replaces stub)**

```
admin/onboarding.completed { onboardingId }
  └─ Step "load-onboarding": call api.adminOnboarding.getAdminOnboardingAction with shared secret.
       Bail if status !== "processing" (NonRetriableError; do not retry on terminal state).
  └─ Step "send-student-email":
       Use RESEND_TEMPLATE_ID_PURCHASE_ONBOARDING + variables
         { isAdminOnboarded: true, isRenewal: <allPairsRenewal>, instructorCount: N, ...existing vars }.
       Idempotency: skip if emailsSent.student === true.
       On success: appendTimelineEntryAction(event="email_sent", details={ recipient:"student", resendMessageId })
                 + set emailsSent.student = true.
       On Resend skip (no API key): appendTimelineEntryAction(event="email_skipped", details={ recipient:"student", reason:"resend_not_configured" }) + still set emailsSent.student = true.
  └─ Step "send-instructor-emails":
       For each instructor NOT in emailsSent.instructorIds:
         Use RESEND_TEMPLATE_ID_INSTRUCTOR_PURCHASE + variables
           { isAdminOnboarded: true, isRenewal: <pair.isRenewal>, instructorCount: 1, ... }.
         On success: appendTimelineEntryAction + push instructorId to emailsSent.instructorIds.
       Per-pair renewal subject rule: "Renewal — <email>" if pair.isRenewal, else "New student assigned — <email>".
  └─ Step "send-admin-email":
       Use RESEND_TEMPLATE_ID_ADMIN_PURCHASE + variables
         { isAdminOnboarded: true, instructorCount: N, ... }.
       Body renders the full per-instructor table (renewal flags, workspace links, Clerk invitation IDs).
       Recipients: all ADMIN_EMAILS (comma-joined; same as existing purchase flow).
       Idempotency: skip if emailsSent.admin === true.
  └─ Step "enqueue-discord-dms":
       For each assigned instructor:
         Enqueue migrateDiscordAction({ kind: "dm_instructor_new_signup", subjectUserId: "email:<email>", instructorId, onboardingId }).
         The existing clerk-user-linking handler rewrites subjectUserId on clerk/user.created.
  └─ Step "mark-completed":
       patch adminOnboardings.status = "completed", completedAt = now.
       appendTimelineEntryAction(event="completed").
  Catch (uncaught error after retries exhausted):
       patch adminOnboardings.status = "failed", failureReason = <error.message>.
       appendTimelineEntryAction(event="failed", details = <error.message>).
       Send admin digest email with the onboarding row link.
```

**Idempotency considerations (PR 3)**

- Every step guards on the corresponding `emailsSent.*` flag — same pattern as the PR 2 stub.
- `enqueue-discord-dms` is idempotent because `migrateDiscordAction` is idempotent on `subjectUserId`.
- The PR 2 atomic `expectedStatus` + `expectedAttemptCount` guard on `appendTimelineEntry` already protects against stale-arrival duplicates — reused by every PR 3 step.

**Email variable additions (no new templates)**

| Template | New optional vars |
|---|---|
| `RESEND_TEMPLATE_ID_PURCHASE_ONBOARDING` | `isAdminOnboarded: boolean`, `isRenewal: boolean` (true only if every selected pair is a renewal), `instructorCount: number` |
| `RESEND_TEMPLATE_ID_INSTRUCTOR_PURCHASE` | `isAdminOnboarded: boolean`, `isRenewal: boolean` (per-pair), `instructorCount: number` |
| `RESEND_TEMPLATE_ID_ADMIN_PURCHASE` | `isAdminOnboarded: boolean`, `instructorCount: number` (table already shows renewal flags) |

**Daily stale digest (`adminOnboardingStaleDigestFlow`)**

```
Cron: 0 9 * * * (UTC)
Trigger: scheduled; no event payload.
Steps:
  ├─ "scan-stale":
  │     List adminOnboardings where status="completed"
  │       AND createdAt < now - 13 days
  │       AND any assigned session pack has userId matching /^email:/
  │       (placeholder not yet rewritten by clerk/user.created).
  │     Bail if list is empty.
  ├─ "send-digest":
  │     One batched email to ADMIN_EMAILS with per-row:
  │       student email, assigned instructors, days pending, suggested action ("resend invite" / "cancel").
  ├─ "release-placeholders":
  │     For each stale row:
  │       patch seatReservations.status = "released" for the placeholder session pack.
  │       patch workspaces.endedAt = now for each newly-created workspace.
  │       appendTimelineEntryAction(event="released", details="stale-invite-digest auto-release").
```

**`appendTimelineEntry` enrichment for PR 3**

- Add an internal helper to atomically patch `emailsSent.<field>` AND append a timeline entry in a single mutation (currently they require two calls). Used by every PR 3 send step so retries land on consistent state. Backwards-compatible: existing `appendTimelineEntry` callers continue to work; new `markEmailSent` helper is additive.

**Verification (target for PR 3)**

- `npx convex codegen --typecheck enable` clean.
- `NODE_OPTIONS='--max-old-space-size=8192' pnpm typecheck` clean.
- `pnpm lint` clean.
- `pnpm test:unit --run` clean (add unit tests for: stale-digest selection query, `markEmailSent` helper atomicity, Resend skip-on-missing-key behavior, Inngest flow retry-after-partial-send resume).
- `cd apps/platform && pnpm build` clean.
- End-to-end manual in staging: submit a Kajabi admin onboarding via the new form, watch Inngest dashboard, verify all three emails land with the correct template + new variables, verify the Discord DM is queued with placeholder `subjectUserId`, verify the row's `status: completed` and `timeline` entries. Trigger the stale-digest handler manually; verify digest email + seat release. Re-run with `Resend` env vars missing to verify the `email_skipped` timeline path.
- Greptile CLI local review before push (`npx greptile@latest review --diff -b main`); Greptile cloud review on PR open.

**Rollback**: revert the Inngest handler to the PR 2 stub; remove the daily digest scheduled function. Emails stop; existing `adminOnboardings` data is unaffected. Schedule via `inngest.createFunction` is local to the file, so deletion is a single-file revert.

### PR 4 — Greptile fix pass for all PR #636 review findings — PR OPENED (#637)

**Goal**: address every issue flagged across 8 Greptile review rounds on PR #636.

**Shipped in PR 4**:

- **Round 1 — core asks**: real seat/workspace/session-pack release in stale-digest via `releasePlaceholderInventoryInternal` (patches `seatReservations.status="released"`, `workspaces.endedAt=now`, `sessionPacks.status="expired"` + timeline `released` event). Real instructor email lookup via `getInstructorContactsInternal` (batched email+name with `users` table cross-reference). `adminOnboardingFlow` body wrapped in try/catch with `mark-failed` + `send-admin-failure-digest` steps.
- **Round 2**: `STALE_CUTOFF_MS` constant moved inside step. Filter changed from non-existent `row.sessionPackIds` to `row.perInstructor.some(p => !p.isRenewal && p.sessionPackId)`. All `convex.action` calls wrapped in `Promise.all` with per-item try/catch. Instructor names resolved via batched action in all 3 email steps. `adminSummary` marked true on `anyOk` (was `allOk`) with per-address tracking.
- **Round 3**: digest `sendEmail` calls awaited via `Promise.all` with per-recipient try/catch. `workspaceUrl` ternary simplified to `baseUrl + "/dashboard"`.
- **Round 4**: `appendTimelineEntry` `emailsSentPatch.instructors` now concatenates + dedupes via `Set` (was shallow-overwrite).
- **Round 5**: `listAdminOnboardingsAction` (shared-secret gated) added for Inngest workers without auth identity.
- **Round 6**: `escapeHtml` helper added to digest; `row.email` + view URL escaped. `listAdminOnboardingsInternal` limit raised from 100 → 1000.
- **Round 7**: `releasePlaceholderInventoryInternal` now guards on `pack.userId.startsWith("email:")` to avoid expiring live packs. All 3 email steps re-fetch `freshRow` via `getAdminOnboardingAction` at step start to defeat Inngest memoization on retry.
- **Round 8**: `onboardingId` arg renamed to `id` in 3 `getAdminOnboardingAction` calls (matches validator).

**Files**: `convex/adminOnboarding.ts` (added 3 action/query pairs; fixed `appendTimelineEntry` merge); `apps/platform/inngest/functions/onboarding.ts` (real handler + try/catch + per-step idempotency re-fetches); `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts` (uses new action + escapeHtml + cutoff-inside-step).

**Verification**: `npx convex codegen --typecheck enable` ✓; `pnpm typecheck` ✓; `pnpm build` ✓; `pnpm test:unit --run` 95 passed | 3 skipped. Greptile CLI confidence 5/5, safe to merge.

### Branching + Review Hygiene

- All three branches off `main`; merge in order (1 → 2 → 3). Do not stack the branches into a single PR.
- Local Greptile CLI (`npx greptile@latest review --diff`) before push on every PR.
- One squashed commit per PR after local review is clean — avoids re-triggering the GitHub App on force-pushes.
- Greptile cloud reviews fire once per PR via the GitHub App, configured per `AGENTS.md`.
- Codegen (`npx convex dev`) is regenerated as part of PR 1's diff; PRs 2 and 3 do not change schema, so no regeneration needed unless they touch generated types.

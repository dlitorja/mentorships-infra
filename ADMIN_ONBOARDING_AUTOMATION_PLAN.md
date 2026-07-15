# Admin Onboarding Automation (Kajabi) — Plan

Status: planned, not yet implemented. Source of truth for the work below; supersedes any informal discussion in chat.

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

### PR 1 — Schema + Mutations + Recovery Dashboard Scaffold

**Goal**: land the data model, the three core mutations, the preview query, and the read-only recovery dashboard. Zero email sends, zero Inngest events; only DB writes.

**Files**

- `convex/schema.ts` — add `adminOnboardings` table; widen `users.role` union with `"support"`; add `users.onboardingAlias: v.optional(v.string())`; add `workspaceAuditLogs.adminOnboardingId: v.optional(v.id("adminOnboardings"))`.
- `convex/adminOnboarding.ts` (new) — `previewAdminOnboarding` query; `adminOnboardStudent` mutation; `retryAdminOnboarding` mutation; `cancelAdminOnboarding` mutation; `getAdminOnboarding` query; `listAdminOnboardings` query; `getInstructorOptionsForOnboarding` query.
- `convex/_generated/*` — refreshed by `npx convex dev` (per AGENTS.md Engineering Quality Policy: codegen stays in sync).
- `convex/studentOnboarding.ts` — read-only reference for the `createSeatReservation` / workspace auto-creation pattern; no edits.
- `apps/platform/lib/auth-helpers.ts` — add `requireAdminOrSupportForApi`; widen `UserRole` type union.
- `apps/platform/lib/queries/convex/use-users.ts` — widen returned `UserRole` typing if it asserts a closed union.
- `apps/platform/app/admin/onboardings/page.tsx` (new) — read-only list view (Needs attention / Pending signup / In progress / Completed / Cancelled tabs).
- `apps/platform/app/admin/onboardings/[id]/page.tsx` (new) — read-only detail page rendering `timeline`, per-pair assignments, linked workspaces, email receipts. Polls `/api/admin/onboardings/[id]` every 2 s while in-flight (v1).
- `apps/platform/app/admin/client-admin-layout.tsx` — add `ListChecks` sidebar entry pointing to `/admin/onboardings`.

**Verification**: `pnpm lint && pnpm typecheck`; Greptile CLI local review; unit tests for state transitions (illegal transitions rejected), idempotency lookup by `(email, instructorIds)`, capacity-override-requires-reason, advanced-split-requires-notes, `timeline` append-only invariant, retry increments `attemptCount`, cancel writes `cancelled` timeline entry. Manual smoke in dev: create onboarding via the existing API surface (mocked), confirm rows land in `adminOnboardings`, dashboard renders correctly.

**Rollback**: drop the `adminOnboardings` table; no production user data is touched because PR 1 has no email/Inngest side effects.

### PR 2 — API Route + Form (Preview/Confirm)

**Goal**: extend `/admin/students/invite` with the mode toggle and two-phase form; expose the sibling API routes; wire the retry/cancel admin endpoints. No email sends (Inngest events emitted but the handler from PR 3 is not yet present — log-only stub).

**Files**

- `apps/platform/app/admin/students/invite/page.tsx` — add mode toggle, existing-student banner, capacity badges, advanced disclosure + confirmation modal, capacity-override reason field, internal notes textarea, Preview button + preview panel, Confirm and Send button.
- `apps/platform/app/api/admin/students/onboard/preview/route.ts` (new) — POST; calls `previewAdminOnboarding`; zero side effects.
- `apps/platform/app/api/admin/students/onboard/route.ts` (new) — POST; calls `adminOnboardStudent`; zod validation; emits `admin/onboarding.completed` Inngest event.
- `apps/platform/app/api/admin/onboardings/[id]/route.ts` (new) — GET; returns the current row (polling target).
- `apps/platform/app/api/admin/onboardings/[id]/retry/route.ts` (new) — POST; calls `retryAdminOnboarding`.
- `apps/platform/app/api/admin/onboardings/[id]/cancel/route.ts` (new) — POST; calls `cancelAdminOnboarding`.
- `apps/platform/inngest/functions/onboarding.ts` — add a stub `adminOnboardingFlow` handler that logs the event payload and updates `adminOnboardings.emailsSent = { stub: true }` so PR 1's preview UI shows realistic state. Replaced fully by PR 3.
- `apps/platform/inngest/types.ts` — add `adminOnboardingCompletedEventSchema` (used in stub; reused in PR 3).

**Verification**: Playwright e2e for the new form mode (`tests/e2e/admin-onboarding.spec.ts`); manual: preview shows zero new rows, confirm creates the expected rows, cancel-on-preview writes nothing, capacity-override requires reason. `pnpm lint && pnpm typecheck`; Greptile CLI local review.

**Rollback**: revert the new API routes and form section. The mutations and schema from PR 1 are unaffected.

### PR 3 — Inngest Flow + Resend + Daily Digest

**Goal**: replace the PR 2 stub with the real Inngest handler; extend Resend templates; enqueue Discord DMs; wire the daily stale-digest cron.

**Files**

- `apps/platform/inngest/functions/onboarding.ts` — replace stub `adminOnboardingFlow` with the real handler: send student email (template `RESEND_TEMPLATE_ID_PURCHASE_ONBOARDING` + new optional vars), one instructor email per assigned instructor (template `RESEND_TEMPLATE_ID_INSTRUCTOR_PURCHASE`), one admin summary email (template `RESEND_TEMPLATE_ID_ADMIN_PURCHASE`), enqueue `dm_instructor_new_signup` per instructor with placeholder `subjectUserId`, append `timeline` entries per send, patch `status: "completed"` on success or `"failed"` with `failureReason` on uncaught error, append final timeline entry.
- `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts` (new) — daily Inngest scheduled function (09:00 UTC); queries `adminOnboardings` by `status: completed` AND placeholder `userId` AND `createdAt < now - 13d`; emails admins a digest; releases placeholder seat reservations.
- `apps/platform/inngest/functions/clerk-user-linking.ts` — no edits; existing handler already rewrites `discordActionQueue.subjectUserId` on `clerk/user.created`. Verify in PR 3 review.
- `packages/emails/src/send.ts` — confirm variable pass-through; no schema change to the function signature.
- `apps/platform/lib/emails/purchase-onboarding-email.ts`, `instructor-onboarding-email.ts`, `admin-purchase-notification-email.ts` — extend renderers to accept the new optional vars (`isAdminOnboarded`, `isRenewal`, `instructorCount`).
- `convex/discordActionQueue.ts` — confirm the placeholder-subjectId flow works with admin-onboarded records; small helper if needed.

**Verification**: end-to-end manual in staging: submit a Kajabi admin onboarding, watch Inngest dashboard, verify all three emails land with the correct template, verify the Discord DM is queued, verify the row's `status: completed` and `timeline` entries. Trigger the stale-digest handler manually; verify email + seat release. `pnpm lint && pnpm typecheck`; Greptile CLI local review; Greptile cloud review on PR open.

**Rollback**: revert the Inngest handler to the PR 2 stub; remove the new scheduled function; emails stop. Existing data in `adminOnboardings` is unaffected.

### Branching + Review Hygiene

- All three branches off `main`; merge in order (1 → 2 → 3). Do not stack the branches into a single PR.
- Local Greptile CLI (`npx greptile@latest review --diff`) before push on every PR.
- One squashed commit per PR after local review is clean — avoids re-triggering the GitHub App on force-pushes.
- Greptile cloud reviews fire once per PR via the GitHub App, configured per `AGENTS.md`.
- Codegen (`npx convex dev`) is regenerated as part of PR 1's diff; PRs 2 and 3 do not change schema, so no regeneration needed unless they touch generated types.

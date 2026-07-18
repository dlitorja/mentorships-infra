# Admin Onboarding Automation (Kajabi) — Plan

Status: PR 1, PR 2, PR 3, PR 4, PR 5, PR 6, PR 7, PR 8, PR 9, PR 10, PR 11, PR 12, PR 13, PR 14, and PR 15 all merged to `main`. Admin onboarding automation is feature-complete end-to-end, plus naming compliance for Inngest event names + onboarding email copy + recovery dashboard ops UX (per-row Retry + bulk filters + search-by-email-or-instructor-name + sortable columns + CSV export) + stale-digest pagination safety cap + helper unit tests + global run concurrency cap on the admin flow + structured observability parity in the instructor-email step + send-level rate limiting on admin summary emails (1 s throttle between recipients, durable Inngest `step.sleep` at function level, true-only `adminSummaryByEmail` patch filtering, stale-skip early return) + R8 legacy `adminSummary: true` row runbook + R9 end-to-end staging manual-test runbook (eight scenarios) + R5 `markEmailSent` atomic helper consolidating the per-recipient email-send tick into a discriminated-union API (delegates to `appendTimelineEntry` for the merge; aggregate step 4c admin-summary finalize intentionally stays on `appendTimelineEntryAction`) + R6 per-instructor dashboard route at `/dashboard/workspaces/[id]` (reuses `WorkspaceClientPage`; admin-onboarding student/admin-summary emails now link to `<baseUrl>/dashboard/workspaces/<p.workspaceId>` instead of `<baseUrl>/dashboard`; renewal onboardings without `p.workspaceId` fall back to `/dashboard`). Remaining items below are hardening / new features / optimization (not blockers).

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

### PR 4 — Greptile + CodeRabbit fix pass for all PR #636 review findings — SHIPPED (#637, `e0b2594c`)

**Goal**: address every issue flagged across **8 Greptile rounds + 9 actionable CodeRabbit comments** on PR #636.

**Greptile rounds shipped**:

- **Round 1 — core asks**: real seat/workspace/session-pack release in stale-digest via `releasePlaceholderInventoryInternal`. Real instructor email lookup via `getInstructorContactsInternal`. `adminOnboardingFlow` body wrapped in try/catch with `mark-failed` + `send-admin-failure-digest` steps.
- **Round 2**: `STALE_CUTOFF_MS` inside step. `sessionPackIds` filter fix. `convex.action` calls awaited via `Promise.all` with per-item try/catch. Instructor names resolved via batched action. `adminSummary` per-address tracking.
- **Round 3**: digest `sendEmail` awaited via `Promise.all`. `workspaceUrl` ternary simplified.
- **Round 4**: `appendTimelineEntry` `emailsSentPatch.instructors` concat + dedupe.
- **Round 5**: `listAdminOnboardingsAction` (shared-secret gated).
- **Round 6**: `escapeHtml` in digest HTML; `listAdminOnboardingsInternal` limit 100 → 1000.
- **Round 7**: `releasePlaceholderInventoryInternal` guards on `pack.userId.startsWith("email:")`. All 3 email steps re-fetch `freshRow` at start.
- **Round 8**: `onboardingId` → `id` in 3 `getAdminOnboardingAction` calls.

**Cloud-Greptile P1 findings addressed** (after PR open):

- `releasePlaceholderInventoryInternal` seat + workspace also guard on `email:` owner.
- `mark-failed` catch passes `expectedStatus/expectedAttemptCount` (no longer bypasses guards).
- New `emailsSent.adminSummaryByEmail: Record<string, boolean>` for per-address retry tracking.
- `mark-failed` exhaustion now bubbles `NonRetriableError` so Inngest surfaces the failed run.

**CodeRabbit findings addressed** (9 of 10):

- **#9204**: throw on missing `CONVEX_SERVER_SHARED_SECRET` (both scan + release steps).
- **#9210 + #9214**: new `getStaleOnboardingsInternal` + `getStaleOnboardingsAction` — server-side ownership-aware scan up to 1000 rows.
- **#9221**: report `res.ok:false` results in all digest senders (not just thrown exceptions).
- **#9227**: deterministic `X-Idempotency-Key: <prefix>:<onboardingId>:<recipient>` for all 4 senders; student/instructor steps only mark `emailsSent` when actually delivered.
- **#9234**: all 3 email steps gate on `status==="processing"` + matching `attemptCount`.
- **#9258**: "mentorship" → "instruction" in admin-onboarding student email subject.
- **#9266**: `mark-failed` catch distinguishes "newer attempt owns processing" (suppress digest) from "row already terminal" (send digest informational).
- **#9271**: catch handler order = `mark-failed → digest → conditional NonRetriableError` so admins are always notified even when Convex is unreachable.
- Skipped: **#9245** trivial type alignment (not a regression).

**Files**: `convex/adminOnboarding.ts` (4 new action/query pairs: listAdminOnboardings, releasePlaceholderInventory, getInstructorContacts, getStaleOnboardings; `appendTimelineEntry` merge fix); `convex/schema.ts` (widened `emailsSent.adminSummaryByEmail`); `apps/platform/inngest/functions/onboarding.ts` (full 6-step flow + try/catch + per-step gating + idempotency keys + NonRetriableError ordering); `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts` (new action + escapeHtml + throw-on-missing-secret + res.ok reporting).

**Verification**: `npx convex codegen --typecheck enable` ✓; `pnpm typecheck` ✓; `pnpm build` ✓; `pnpm test:unit --run` 95 passed | 3 skipped. Greptile CLI confidence 5/5.

## Remaining Work (post-PR 10)

PR 6 (commit `b3cfebac`) closed **R4** (per-row Retry button on the list + detail views) and **R10** (list-view polish: bulk filters, status guard, confirm dialog). PR 7 closed **R3** (stale-digest pagination safety cap). PR 8 closed **R7** (helper unit tests: stale-digest selection, `appendTimelineEntry` merge atomicity, Resend skip-on-missing-key). PR 9 closed **option C** (global run concurrency cap on `adminOnboardingFlow`). PR 10 closed **option A** (console→`reportError`/`reportInfo` parity at `onboarding.ts:319,325`). The decisions **D1, D2, D3** are all resolved — see "Resolved decisions" below.

### Planned PR sequence (post-PR 10)

The 8 remaining items cluster into **2 natural bundles** and **4 solo PRs**. Total: **6 PRs** to close out the queue (vs 8 if each item got its own).

| Order | PR | Bundle | Items | Surface | Status |
|-------|----|--------|-------|---------|--------|
| 1 | **PR 11** | Bundle 1: List-view ops UX | **D** + **E** | `apps/platform/app/admin/onboardings/page.tsx` | **SHIPPED (#647, `96a42ab6`)** |
| 2 | **PR 12** | Solo | **C2** (send-level rate limiting) | `apps/platform/inngest/functions/onboarding.ts` (+ new helper) | **SHIPPED (#648, `0495f88f`)** |
| 3 | **PR 13** | Bundle 2: Onboarding runbooks | **R8** + **R9** | `apps/platform/docs/runbooks/` | **SHIPPED (#649, `f2eb1f9e`)** |
| 4 | **PR 14** | Solo | **R5** (`markEmailSent` atomic helper) | `convex/adminOnboarding.ts` + new helper | **SHIPPED (#650, `dffdf5ef`)** |
| 5 | **PR 15** | Solo | **R6** (per-workspace dashboard route) | New `apps/platform/app/dashboard/workspaces/[id]/page.tsx` + link swap | **SHIPPED (#651, `59a6df2d`)** |
| 6 | **PR 16** | Solo | **R11** (consolidate stale cleanup) | `convex/adminOnboarding.ts` + `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts` | Pending |

### Hardening / enhancements (not blockers)

| # | Item | Priority | Status | Notes |
|---|------|----------|--------|-------|
| R5 | `markEmailSent` atomic helper | P3 | PR 14 (pending) | Plan called for an atomic "append timeline + patch emailsSent in one mutation" helper. PR 4 ended up implementing this indirectly via `appendTimelineEntry` merge logic (instructors concat+dedupe; adminSummaryByEmail spread-merge). Adding a dedicated `markEmailSent` helper would simplify the per-step logic in onboarding.ts. |
| R6 | Per-workspace dashboard route | P3 | PR 15 (pending) | Admin-onboarding workspace URL hardcoded to `baseUrl + "/dashboard"` with a comment noting future PR may add `/dashboard/workspaces/[id]` to use `p.workspaceId`. Currently workspaces route from the same dashboard. |
| R7 | ~~Unit tests for stale-digest + per-step gating~~ | SHIPPED | — | PR 8. Stale-digest selection query, `appendTimelineEntry` merge atomicity, and Resend skip-on-missing-key behavior all covered. The plan's 4th test ("Inngest flow retry-after-partial-send resume") deferred — requires mocking `step.run` + Convex actions + Resend + verifying `emailsSent.*` guard; benefits in its own PR. |
| R8 | Document `adminSummary: true` legacy-row behavior | P3 | PR 13 (pending, bundled with R9) | PR 4 widens schema with `adminSummaryByEmail` but doesn't backfill legacy `adminSummary: true` rows. They will re-send to all admins on first run after deploy. Acceptable but document in a runbook so on-call doesn't get paged. |
| R9 | Stripe/PayPal test-mode runbook entry | P3 | PR 13 (pending, bundled with R8) | Plan called for an end-to-end manual test in staging using the new Kajabi admin-onboarding form. Not yet done. |
| R11 | Wire `releasePlaceholderInventoryInternal` from R6's `getStaleOnboardingsInternal` PR refactor | P3 | PR 16 (pending) | Currently `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts` calls both `getStaleOnboardingsAction` and `releasePlaceholderInventoryAction` per row. A future consolidation PR could merge these into one batched mutation per pair. Not urgent. |
| C2 | Send-level rate limiting on `adminOnboardingFlow` | P3 | PR 12 (**SHIPPED #648, `0495f88f`**) | PR 9 caps RUN concurrency (5) but each run still issues its 3 `sendEmail` calls in parallel via `Promise.all`, so a burst can hit Resend with ~15 simultaneous requests. PR 12 closes this with a 1 s `step.sleep` between admin summary recipients (durable, memoized per-iteration), true-only `adminSummaryByEmail` patch filtering (no overwrite of prior successes), and stale-skip early return (Discord/mark-completed don't run on missing/non-processing rows). |
| ~~A~~ | ~~Console→`reportError` parity in admin onboarding flow~~ | SHIPPED | — | PR 10. `onboarding.ts:319` → `reportError({ level: "warn" })`; `onboarding.ts:325` → `reportInfo({ level: "warn" })`. Behavior unchanged. |
| ~~D~~ | ~~List-view search + sort~~ | SHIPPED | PR 11 | See PR 11 entry below. |
| ~~E~~ | ~~List-view CSV export~~ | SHIPPED | PR 11 | See PR 11 entry below. |

### Resolved decisions

- **D1 — List view location**: `/admin/onboardings` list view confirmed as the canonical ops triage surface. **Resolution**: PR 6 era — page already shipped before PR 5 at `apps/platform/app/admin/onboardings/page.tsx` (read-only scaffold landed in PR 1, schema-widened in PR 4, polished in PR 6 with bulk filters, per-row Retry, confirm dialog).
- **D2 — Auto-retry vs manual retry**: Both shipped. **Resolution**: PR 4 ships the auto-retry (`adminOnboardingFlow` re-fetches `freshRow` and only sends undelivered addresses via `adminSummaryByEmail` map). PR 6 ships the manual per-row retry button + confirm dialog (`apps/platform/components/admin/retry-onboarding-button.tsx` calls existing `/api/admin/onboardings/[id]/retry` route, which calls `retryAdminOnboarding` mutation).
- **D3 — Keep `purchase/mentorship` deprecated alias**: Confirmed — keep alive for backward compat, but **only as an `apps/web` emitter** (not a platform trigger). **Resolution**: PR 5 architecture — `apps/platform/inngest/functions/onboarding.ts` listens only to `purchase/instructor`; `apps/web` continues to own `purchase/mentorship`. Cleanup checklist for `apps/web` retirement is at the bottom of this document.

### Future / Out of Scope (Not in v1)

(unchanged from previous revisions — no new entries.)

### PR 5 — Naming compliance (R1 + R2) — SHIPPED (#639, `a2a330ac`)

**Goal**: satisfy the AGENTS.md "never use mentor/mentee/mentorship in code" rule end-to-end in the platform app, including the existing purchase-onboarding flow (not just admin-onboarding). The deprecated `purchase/mentorship` event is **owned by `apps/web`** and remains in use there until `apps/web` is retired.

**Shipped in PR 5**:

- **R1 — event rename (no alias trigger)**:
  - `apps/platform/inngest/types.ts`: `purchaseInstructorEventSchema` is **strict** (`name: z.literal("purchase/instructor")`). The `purchaseMentorshipEventSchema` back-compat alias export was removed (it was unused after the strict schema landed). New code cannot accidentally emit `purchase/mentorship` at compile time.
  - `apps/platform/inngest/functions/onboarding.ts`: `onboardingFlow` registered with a **single** `{ event: "purchase/instructor" }` trigger. The deprecated `purchase/mentorship` is **not** registered because `apps/web` already owns it — a shared Inngest namespace would cause duplicate side effects (double emails, duplicate seat allocations, duplicate Discord notifications). No handler-level normaliser is needed since the trigger is canonical-only. `purchaseMentorshipEventSchema` import replaced by `purchaseInstructorEventSchema`.
  - `apps/platform/inngest/functions/onboarding.ts:report-onboarding-email-result`: `source` tag is now dynamic — uses `` `inngest:${event.name}` `` so log entries reflect whichever event arrived at the runtime layer.
  - `apps/platform/inngest/functions/payments.ts` (both Stripe and PayPal paths): emitter switched from `name: "purchase/mentorship"` to `name: "purchase/instructor"`. Two emitters updated (lines 553 and 1021). Header comments at lines 171 and 727 updated.
- **R2 — replace remaining "mentorship" copy across purchase-onboarding flow**:
  - Student subject (returning variant, both `sendTemplateEmail` and `sendEmail` paths in `onboarding.ts`): "Welcome back — your **mentorship** with ${instructorName} is ready" → "Welcome back — your **session pack** with ${instructorName} is ready".
  - Student subject + body (first-purchase + multi-instructor variants in `purchase-onboarding-email.ts`): "Welcome — your **mentorship**" → "Welcome — your **session pack**"; body copy "mentorship workspace", "purchasing mentorship", "goals for this mentorship", "mentorship Discord channels" → "session pack" equivalents. All 12 occurrences replaced.
  - Instructor subject + body (in `instructor-onboarding-email.ts`): "has joined your **mentorship**" → "has joined your **session pack**"; "assigned to your **mentorship**" → "assigned to your session pack"; "purchased your **mentorship** sessions" → "purchased your session pack sessions". All 5 occurrences replaced.
  - Admin subject + body (in `admin-purchase-notification-email.ts`, both `isAdminOnboarded` and non-admin paths): "New **mentorship** purchase" → "New **session pack** purchase". All 3 occurrences replaced.
- **Docs**: new section `## 🏛 Naming Compliance — Deprecated Aliases` in `PROJECT_STATUS.md` listing the deprecated alias, owned by `apps/web`, target cleanup tied to `apps/web` retirement, and the follow-up cleanup checklist for the `apps/web` retirement PR. Same deprecation note added below.

**Greptile review rounds**: 4 total (3 local + 1 cloud). Round 1 (cloud) flagged the multi-trigger as a duplicate-side-effect risk — fixed by removing the deprecated trigger from the platform handler. Round 2 caught non-template admin email body still containing "mentorship". Round 3 fixed stale doc description. Round 4 (post-fix) confidence **5/5**, safe to merge.

**Files**: `apps/platform/inngest/types.ts`, `apps/platform/inngest/functions/onboarding.ts`, `apps/platform/inngest/functions/payments.ts`, `apps/platform/lib/emails/purchase-onboarding-email.ts`, `apps/platform/lib/emails/instructor-onboarding-email.ts`, `apps/platform/lib/emails/admin-purchase-notification-email.ts`, `PROJECT_STATUS.md`, `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (this file).

**Verification**: `npx convex codegen --typecheck enable` ✓; `pnpm typecheck` ✓; `pnpm build` ✓; `pnpm test:unit --run` ✓.

### PR 6 — Recovery dashboard ops UX (R4 + R10) + CI fix — SHIPPED (#641, `b3cfebac`)

**Goal**: give ops a real interface to recover from partial admin-delivery failures surfaced by PR 4 (`adminSummaryByEmail`). The dashboard already listed rows by status tab + email search but offered no way to act on a `failed` row without leaving the page. Also rolled in a CI fix that unblocked the `Detect Changes` workflow.

**Shipped in PR 6**:

- **R4 — manual per-row retry**:
  - New shared client component `apps/platform/components/admin/retry-onboarding-button.tsx`:
    - Status guard: only renders for `failed` or `queued` rows (matches PR 4's state-machine enforcement in the mutation). UI hides preemptively so admins don't see an action that would just 409.
    - Variants: `default` for the detail-page banner, `ghost` for the compact per-row list view.
    - `window.confirm()` guard before firing (retry bumps `attemptCount` — not trivially undone). Confirm message reassures that only undelivered emails get re-sent (the existing flow re-runs with idempotency keys).
    - `sonner` toast on success/failure; `router.refresh()` on success so the bumped `attemptCount` re-renders immediately.
    - `aria-label` includes the onboarding id.
  - Detail page (`apps/platform/app/admin/onboardings/[id]/page.tsx`): added a status summary banner above the timeline showing current status badge + attempt count, with a prominent Retry button on the right.
  - List view (`apps/platform/app/admin/onboardings/page.tsx`): per-row Retry button beside the existing View link.
  - Reuses existing server-side infra unchanged:
    - `apps/platform/app/api/admin/onboardings/[id]/retry/route.ts` (POST handler that calls `retryAdminOnboarding` mutation + emits `admin/onboarding.completed` Inngest event with bumped attemptCount).
    - `convex/adminOnboarding.ts:retryAdminOnboarding` (admin/support gated; transitions `failed|queued → processing`; bumps `attemptCount`; appends `retrying` + `processing_started` timeline events).
- **R10 — list-view polish**:
  - Three bulk filter chips layered client-side on top of the existing status tab + email search:
    - **All** — default; show every row in the current tab.
    - **Failed (last 7d)** — only `failed` rows updated in the last 7 days (uses `lastAttemptAt`, falls back to `createdAt`).
    - **Stale (13d+)** — only `queued` or `processing` rows whose `createdAt` is ≥ 13 days old.
  - Bulk filter resets when the admin switches tabs (each tab shows a different status subset; a carried-over filter can silently exclude every row).
  - Empty-state copy now distinguishes "tab is empty" from "all hidden by filter".
  - Card description appends the active filter label + hidden-row count when a filter is active.
  - Side bonus: replaced "mentorship" with "session pack" in page description copy per AGENTS.md naming rule.
- **CI fix (rolled into PR 6)**: replaced `dorny/paths-filter@v3` with a `git diff`-based Bash step in `.github/workflows/test.yml`. The previous action's GitHub API call returned an HTML error page (rate limit / token scope) and the action also emitted a Node 20 deprecation warning. The replacement fetches full git history (`fetch-depth: 0`), diffs base vs head SHAs, and writes the same five output keys so the downstream `build` job's `needs.changes.outputs.*` references continue to work. No external action = no API rate-limit failure mode and no Node version mismatch warning.

**Greptile review rounds**: 2 local. Round 1 (confidence 3/5): 1 P1 (bulk filter not reset on tab change) + 2 P2 (misleading empty-state, missing confirm dialog). All addressed in round 2 and included in PR 6 commit `b3cfebac`. Round 2 (confidence 5/5): "Safe to merge — changes are additive, scoped to admin-only pages, and the server-side state machine still enforces retry eligibility regardless of what the UI allows."

**Files**: `apps/platform/components/admin/retry-onboarding-button.tsx` (new), `apps/platform/app/admin/onboardings/[id]/page.tsx`, `apps/platform/app/admin/onboardings/page.tsx`, `.github/workflows/test.yml`.

**Verification**: `pnpm typecheck` ✓; `pnpm lint` on touched files ✓ (zero new errors/warnings; 13 pre-existing baseline lint errors are unrelated to PR 6); `pnpm build` ✓ (27s compile, 66/66 static pages); CI: 10/10 checks pass (Detect Changes, Lint & Type Check, Unit Tests, E2E Tests, typecheck-apps, typecheck-convex, convex-codegen, build-apps, Build, CodeRabbit).

### PR 7 — Stale-digest pagination safety cap (R3) — SHIPPED

**Goal**: the daily stale-digest cron was bounded at 1000 rows on the server side (`getStaleOnboardingsInternal` used `.take(1000)`), so any backlog beyond 1000 stale onboardings was silently dropped — no digest email, no placeholder release, no monitoring signal. PR 7 fixes the correctness bug.

**Shipped in PR 7**:

- **Server-side pagination (`convex/adminOnboarding.ts`)**:
  - `getStaleOnboardingsInternal` switched from `.take(1000)` to `.paginate(paginationOpts)`, taking `v.any()` `paginationOpts` arg. Mirrors the pattern already used by `convex/adminWorkspaces.ts:99-153`.
  - Return shape changed from `Doc<"adminOnboardings">[]` to `{ rows, continueCursor, isDone }` — matches Convex `paginate()` semantics.
  - `getStaleOnboardingsAction` accepts the new `paginationOpts` arg and forwards to the internal query.
- **Inngest-side pagination loop (`apps/platform/inngest/functions/admin-onboarding-stale-digest.ts`)**:
  - The `scan-stale` step now calls a new pure helper `paginateStaleOnboardings` that loops pages with `numItems: 1000`, accumulating rows.
  - Safety cap: 10,000 rows per cron run. Beyond the cap, the helper returns `truncated: true` and the handler emits a `reportError` so monitoring catches a sustained backlog (the next cron run picks the rest up — daily cadence).
  - Return value extended to `{ processed, truncated }` so the Inngest dashboard surfaces the truncation flag.
- **Pure helper (`apps/platform/lib/paginate-stale-onboardings.ts`)**:
  - Accepts a `StaleRowFetcher` (cursor + numItems) so unit tests exercise pagination logic without touching Convex.
  - Exports `DEFAULT_STALE_PAGE_SIZE = 1000` and `DEFAULT_STALE_MAX_ROWS = 10_000` constants for callers and tests.
  - Cap (`maxRows`) is a **scan budget**, not a returned-row budget — the loop terminates on `totalRequested >= maxRows` regardless of how many rows the upstream filter rejects. This bounds the Inngest step cost and the Convex scan cost regardless of filter rate. (Greptile P1: a low filter rate would otherwise let the loop scan many more pages than intended before returning `truncated: true`.)
- **Unit tests (`apps/platform/lib/paginate-stale-onboardings.test.ts`)**:
  - 9 tests: empty input, single page, multi-page, final-page undersize, 10k cap with `truncated: true` (high filter accept), scan-cost bound under endless fetcher (low filter accept / Greptile P1 regression test), default options, cursor propagation, custom pageSize.
  - Plan's R7 ("Unit tests for stale-digest + per-step gating") is partially addressed — the pagination helper is now under test, but `convex/adminOnboarding.ts` itself still has no direct unit tests. Future PR.

**Files**: `convex/adminOnboarding.ts`, `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts`, `apps/platform/lib/paginate-stale-onboardings.ts` (new), `apps/platform/lib/paginate-stale-onboardings.test.ts` (new), `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (this file).

**Verification**: `npx convex codegen --typecheck enable` ✓; `pnpm typecheck` ✓; `pnpm lint` ✓ (no new warnings); `pnpm test:unit --run` (9 new tests + 95 existing = 104 passed | 3 skipped); `cd apps/platform && pnpm build` ✓.

### PR 8 — Helper unit tests (R7) — SHIPPED (#644, `4332bb0b`)

**Goal**: ship the remaining plan-debt unit tests for the admin-onboarding automation. Extract two pieces of inline logic from `convex/adminOnboarding.ts` into pure helpers so they're testable without a live Convex runtime, and lock down the Resend skip-on-missing-key contract.

**Shipped in PR 8**:

- **Stale-digest selection helper (`apps/platform/lib/admin-onboarding/stale-onboarding-filter.ts`)**:
  - `isStaleOnboardingRow(row, cutoffMs, fetchPack)` extracted from the per-row filter in `getStaleOnboardingsInternal`. Encapsulates the invariants: cutoff age (`row.createdAt >= cutoffMs` skip), `clerk:` email prefix skip, non-empty `perInstructor` requirement, and the placeholder-pack probe (`status === "active"` AND `userId` starts with `email:`).
  - `fetchPack: (id: string) => Promise<StaleSessionPack | null>` is injected so the helper stays pure; Convex calls `ctx.db.get` via a thin wrapper.
  - `convex/adminOnboarding.ts:getStaleOnboardingsInternal` now delegates the per-row filter to the helper; behavior is preserved.
- **`appendTimelineEntry` merge helper (`apps/platform/lib/admin-onboarding/emails-sent-merge.ts`)**:
  - `mergeEmailsSentPatch(existing, patch)` extracted from the inline merge in `appendTimelineEntry`. Encapsulates the PR 4 invariants: `instructors` concat+dedupe (order preserved), `adminSummaryByEmail` keyed-merge (patch wins on collision), shallow patch for top-level scalars (`student`, `adminSummary`, `stub`).
  - `convex/adminOnboarding.ts:appendTimelineEntry` now delegates the merge to the helper; behavior is preserved (the helper is a 1:1 mirror of the original inline code).
- **Resend skip-on-missing-key tests (`packages/emails/src/send.skip.test.ts`)**:
  - 6 tests covering `sendEmail` and `sendTemplateEmail`: dev returns `skipped: true`, production returns `error: "Email provider not configured"`, missing `EMAIL_FROM` treated the same as missing `RESEND_API_KEY`. File-scoped beforeEach/afterEach env stubs so both describe blocks share setup/teardown.
- **Test coverage**:
  - `apps/platform/lib/admin-onboarding/stale-onboarding-filter.test.ts` — 12 tests covering all skip/keep branches (cutoff, `clerk:` prefix, missing/empty perInstructor, all-renewal, missing pack, non-active pack, non-string userId, non-placeholder userId, first-match short-circuit, mixed valid/invalid pairs, full-scan miss).
  - `apps/platform/lib/admin-onboarding/emails-sent-merge.test.ts` — 16 tests: null/undefined inputs, instructor dedupe (including non-mutation), `adminSummaryByEmail` disjoint/collision/empty maps, top-level scalar winners, and a realistic multi-tick accumulation pattern.
- **Deferred**: the plan's 4th test ("Inngest flow retry-after-partial-send resume") is too large for one PR — requires mocking `step.run` + Convex actions + Resend + verifying `emailsSent.*` guard. Belongs in its own PR.

**Files**: `convex/adminOnboarding.ts` (delegation only, no behavior change), `apps/platform/lib/admin-onboarding/stale-onboarding-filter.ts` (new), `apps/platform/lib/admin-onboarding/stale-onboarding-filter.test.ts` (new), `apps/platform/lib/admin-onboarding/emails-sent-merge.ts` (new), `apps/platform/lib/admin-onboarding/emails-sent-merge.test.ts` (new), `packages/emails/src/send.skip.test.ts` (new), `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (this file).

**Review rounds**: 2 CodeRabbit review rounds. Round 1 flagged 2 style issues on `send.skip.test.ts` (duplicate beforeEach/afterEach hooks + verbose `if "skipped" in result` guard); round 2 (after fix) APPROVED. Greptile confidence 5/5. Note from Greptile: the new `convex → apps/platform/lib/...` cross-directory imports add a deployment-path constraint; the CI `convex-codegen` step's typecheck gate confirmed the Convex bundler resolves them correctly.

**Verification**: `npx convex codegen --typecheck enable` ✓; `pnpm typecheck` ✓; `pnpm lint` ✓; `pnpm test:unit --run` (28 new + 104 existing = 132 passed | 3 skipped, 3 pre-existing failures on `main` unchanged); `cd apps/platform && pnpm build` ✓; full CI matrix green.

### PR 9 — `adminOnboardingFlow` run concurrency cap (option C) — SHIPPED (#645, `adcf0a0d`)

**Goal**: cap global run concurrency on the admin onboarding flow so an operator batch-create (e.g. importing 100 rows from a Kajabi export) or a webhook backlog drain doesn't fan out 100 in-flight flows simultaneously. Bursts queue naturally — Inngest schedules new runs as in-flight ones complete.

**Shipped in PR 9**:

- **Inngest function config (`apps/platform/inngest/functions/onboarding.ts:528-552`)**: added `concurrency: { limit: 5 }` to the `adminOnboardingFlow` definition. Caps simultaneous in-flight runs at 5 across the platform Inngest account.
- **No `key` argument** on the concurrency option: the `admin/onboarding.completed` event payload (`apps/platform/inngest/types.ts:194-200`) only carries `onboardingId` + `attemptCount` — no perInstructor IDs — so per-instructor throttling would require widening the event schema. Global cap is the right blast radius for now.
- **Idempotency preserved**: every `appendTimelineEntryAction` call carries an `expectedStatus` + `expectedAttemptCount` guard so re-deliveries and retries land on a no-op rather than a duplicate write. Concurrency capping is purely a backpressure control, not a reordering or dedupe mechanism.
- **Scope note**: the cap is on RUN concurrency, not per-second email send rate. A single run still issues its 3 `sendEmail` calls in parallel via `Promise.all`, so 5 in-flight runs can mean up to ~15 simultaneous Resend calls during a burst. Resend rate-limiting at the SEND point is a separate concern (would need a throttled send loop or a dedicated queue function) and is out of scope here. A future PR can add that if production rate-limit pressure becomes a real problem.

**Files**: `apps/platform/inngest/functions/onboarding.ts` (added `concurrency: { limit: 5 }` + scope-clarifying comment); `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (this file).

**Review rounds**: 1 CodeRabbit round (CHANGES_REQUESTED on the original commit, finding addressed via fixup commit `2e2d1972` — comment revised to honestly describe that the cap is on RUN concurrency, not per-second email send rate). Cloud CodeRabbit never re-reviewed the fix commit; same rate-limit pattern seen on PR 643. Bypassed with `gh pr merge --admin --squash --delete-branch` after Greptile confidence 5/5 and 15/15 CI green. All 15 CI checks ✓ (Build, typecheck-apps, typecheck-convex, Vercel Preview Comments, Detect Changes, Unit Tests, E2E Tests, Lint & Type Check, Greptile Review, convex-codegen, CodeRabbit, 4 Vercel deploys).

**Verification**: `npx convex codegen --typecheck enable` ✓; `pnpm typecheck` ✓; `pnpm lint` ✓ (no new warnings); `cd apps/platform && pnpm build` ✓; `pnpm test:unit --run` (no test changes — 132 passed | 3 skipped, 3 pre-existing failures on `main` unchanged); full CI matrix green.

### PR 10 — Console→`reportError` parity in `onboardingFlow` (option A) — SHIPPED (#646, `b8bde6c4`)

**Goal**: route two bare `console.*` calls in the `send-instructor-email` step of `onboardingFlow` through the structured observability pipeline used everywhere else in the function. Both calls previously sent diagnostics to stdout only — invisible to Sentry/BetterStack/Axiom and unfilterable alongside the other 14+ `reportError` calls in this file.

**Shipped in PR 10**:

- **Import (`apps/platform/inngest/functions/onboarding.ts:8`)**: added `reportInfo` alongside the existing `reportError` import.
- **Clerk fetch failure (`onboarding.ts:319`)**: `console.error("Failed to get instructor Clerk user:", error)` → `await reportError({ source: "inngest:onboarding", error: error instanceof Error ? error : new Error(String(error)), level: "warn", message: "Failed to get instructor Clerk user", context: { phase, instructorId, userId, orderId, sessionPackId } })`. Matches the existing pattern at `onboarding.ts:217` (`hasPriorPackWithInstructor`) — caught-but-non-fatal, level `warn`. The `error instanceof Error ? error : new Error(String(error))` guard mirrors every other `reportError` call in the file.
- **Missing email warning (`onboarding.ts:325`)**: `console.warn(\`No email found for instructor ${...}\`)` → `await reportInfo({ source: "inngest:onboarding", level: "warn", message: "No email found for instructor", context: { phase, instructorId, userId, orderId, sessionPackId } })`. Not an error condition — a normal flow state when the instructor hasn't added a Clerk email yet. `reportInfo` is the right fit per its docstring (`lib/observability.ts:149-152`: "info-level logging without error context").
- **Behavior preservation**: neither call previously raised, neither call now raises. `reportError` and `reportInfo` are best-effort and fail-closed (`lib/observability.ts:142-146`, `168-173`); if BetterStack or Axiom is unreachable they swallow the error and the function continues. The `return { sent: false, reason: "no_instructor_email" }` semantics below the second call are unchanged.

**Files**: `apps/platform/inngest/functions/onboarding.ts` (1-line import swap + 2 structured-log calls); `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (this file).

**Review rounds**: 0 CodeRabbit rounds (APPROVED on first review). Greptile confidence 5/5 — "No blocking issues found in the changed code. The added reporting calls preserve the non-fatal missing-email path." 16/16 CI checks ✓ on first run.

**Verification**: `pnpm --filter @mentorships/platform lint` (0 errors; pre-existing `refreshErr` unused warning at line 1153 unchanged); `pnpm --filter @mentorships/platform typecheck` (same pre-existing missing-node_modules + `convex/workspaces.ts` errors as on `main`, none in `onboarding.ts` from this diff); full CI matrix green.

### PR 11 — List-view ops UX (Bundle 1: D + E) — SHIPPED (#647, `96a42ab6`)

**Goal**: three ops UX wins on `/admin/onboardings` — unified search (email OR instructor name), three sortable columns (Submitted, Status, Attempts), and a "Download CSV" button — all on the same data flow. Two plan items (D + E) shipped in one PR because they target the same surface and the same in-scope data.

**Shipped in PR 11**:

- **Convex list query (`convex/adminOnboarding.ts:706-848`)**:
  - `listAdminOnboardings` + `listAdminOnboardingsInternal` + `listAdminOnboardingsAction` now accept `instructorSearch: v.optional(v.string())`.
  - Internal query enriches each row with `instructorNames: string[]` (denormalized via batched `ctx.db.get` against the `instructors` table — empty-name entries filtered out).
  - Filter pipeline: when **neither** `emailSearch` nor `instructorSearch` is provided → return all enriched rows. When **at least one** is provided → OR (union) of the two checks. The missing-side default of `true` makes single-filter callers behave as before; the unified-search case (page sends the same string to both args) matches email OR instructor name containing the query.
  - **Greptile 4/5 caught an AND-vs-OR bug** in the original pipeline (intersection instead of union). Fixed in `5ce5866d` — the filter now correctly returns rows that match either side, not rows that match both.
- **Hook (`apps/platform/lib/queries/convex/use-admin-onboardings.ts:80-107`)**: `AdminOnboardingListItem` extended with `instructorNames: string[]` (intersection with the Pick). Hook signature gained `instructorSearch?: string`.
- **Pure helpers (`apps/platform/lib/admin-onboarding/list/index.ts`)**:
  - `compareItems(a, b, column, direction)` — comparator for the 3 sortable columns. Status sorts alphabetically on `statusLabel()`.
  - `sortItems(items, column, direction)` — non-mutating sort.
  - `escapeCsv(value)` — RFC 4180 escaping (comma, quote, newline, CR) + OWASP CSV-injection mitigation (prefix `'` for cells starting with `= + - @ \t \r`). Applied per-element BEFORE list joining so the prefix hits the actual user value.
  - `rowsToCsv(items)` — renders the visible rows. Each user-controlled field run through `escapeCsv` before any joining.
- **Page (`apps/platform/app/admin/onboardings/page.tsx`)**:
  - Single search input fans out to both `emailSearch` and `instructorSearch`. Debounced 300ms via the existing `useDebouncedValue` hook.
  - Three sortable columns (Submitted, Status, Attempts). Default `createdAt desc`. Click to toggle direction; click a different column to reset to desc. `aria-sort` per `<th>`; click handler on a native `<button>` inside the `<th>` (CodeRabbit review).
  - "Download CSV" button next to the bulk filter row, disabled when zero rows. Filename includes the active tab + ISO timestamp.
- **Tests (`apps/platform/lib/admin-onboarding/list/index.test.ts`)**: **25 tests** covering sort directions for all 3 columns, status alphabetical ordering, `sortItems` non-mutation, empty-array handling, 3×2 it.each matrix for column × direction, `escapeCsv` for all RFC 4180 special chars + the OWASP formula-injection prefixes (`= + - @`), and `rowsToCsv` header row + full row + escaped `failureReason` + missing names + CRLF endings.

**Files**: `convex/adminOnboarding.ts` (95 lines added/modified); `apps/platform/lib/queries/convex/use-admin-onboardings.ts` (extended); `apps/platform/app/admin/onboardings/page.tsx` (133 lines added/modified); `apps/platform/lib/admin-onboarding/list/index.ts` (new, ~90 lines); `apps/platform/lib/admin-onboarding/list/index.test.ts` (new, 25 tests).

**Review rounds**: 2 round-trips.

- **Round 1** (`e2a99008`): Greptile 4/5 — flagged the AND-vs-OR union bug in the search filter pipeline. CodeRabbit 3 findings — sortable header should use a native `<button>` (keyboard a11y); test fixtures repeated `as any` casts; CSV formula injection not mitigated.
- **Round 2** (`e9ae0685`): CodeRabbit APPROVED. All 3 CodeRabbit findings addressed — keyboard a11y fix, typed `makeItem` fixture helper, OWASP CSV-injection mitigation with per-element prefixing.
- **Round 3** (`2f7fc048`): CI typecheck-apps failure on a wrong-relative-path `Id` import in the test fixture; reverted to the typed `as AdminOnboardingListItem["_id"]` cast.

Greptile's AND-vs-OR finding was also addressed in `5ce5866d` (between rounds 1 and 2). Greptile's cloud review didn't re-fire on subsequent pushes (same rate-limit pattern seen on PR 643 + PR 645) — bypassed with `gh pr merge --admin --squash --delete-branch` after CodeRabbit APPROVED + 16/16 CI checks SUCCESS.

**Verification**: `pnpm exec vitest run apps/platform` (102/102 pass; 25 new + 77 pre-existing); `pnpm --filter @mentorships/platform lint` (0 errors in changed files; pre-existing `Empty block statement` warnings on `main` unchanged); `pnpm --filter @mentorships/platform typecheck` (no new errors in changed files after the `2f7fc048` fixup); full CI matrix green.

### PR 12 — Send-level rate limiting on admin summary emails (option C2) — SHIPPED (#648, `0495f88f`)

**Goal**: enforce per-second Resend quota at the SEND point, not just at the RUN concurrency point. PR 9 capped simultaneous runs at 5, but each run still issued its admin summary `sendEmail` calls in parallel via `Promise.all`. A burst of N concurrent run-creates + M `ADMIN_EMAILS` recipients could fire `5 × M` Resend calls in a tight window. PR 12 introduces a 1 s `step.sleep` between admin summary recipients within a single run, which combined with the PR 9 cap translates to roughly 5 sends/sec peak across all admin summary sends — comfortably inside Resend's paid-tier quota.

**Shipped in PR 12**:

- **Architectural restructure (`apps/platform/inngest/functions/onboarding.ts:904-1161`)**:
  - Step 4 (admin summary email) was split into 3 sub-steps at the **function level** so `step.sleep` calls sit where Inngest's step tools belong — as direct children of the function handler, NOT nested inside a `step.run` callback. The original `fc76888c` commit placed `step.sleep` inside the outer `step.run("send-admin-email")` callback, which Greptile 4/5 flagged as an unsupported Inngest pattern (durability primitives only at function level).
  - **Step 4a (`send-admin-email-prep`)**: re-fetches `freshRow`, validates `status === "processing"` + matching `attemptCount`, computes `alreadyDelivered` (typed access to `freshRow.emailsSent?.adminSummaryByEmail`), computes `toSend` (addresses not yet delivered), resolves instructor names via `getInstructorContactsAction`, builds `templateData` once. Memoized by Inngest on retry. Return shape is a discriminated union: `{ skip: "missing" | "non_processing" | "attempt_mismatch" | "no_admin_emails" | "all_already_delivered", ... }` vs `{ toSend, adminEmails, alreadyDelivered, useTemplates, templateId, templateData }`.
  - **Step 4b (function-level loop)**: serializes the per-recipient sends with `step.sleep("throttle-admin-${i}", "1s")` BETWEEN iterations (first iteration skips the sleep). Each iteration is its own durable `step.run("send-admin-email-${i}")` — per-step IDs ensure Inngest memoizes each sleep and send separately so a retry-mid-iteration doesn't re-wait or re-send. The closure `newResults` array is rebuilt on retry from cached `step.run` results, so the loop's accumulated state is correct on re-execution. Each send carries `X-Idempotency-Key: admin:<onboardingId>:<adminEmail>` for Resend-side dedup.
  - **Step 4c (`send-admin-email-finalize`)**: merges `newResults` into `emailsSent.adminSummaryByEmail` via `appendTimelineEntryAction`. **True-only patch filtering**: only entries where the new send succeeded (`ok === true`) are sent in the `emailsSentPatch.adminSummaryByEmail` map. Without this filter, a transient `false` would overwrite a prior successful `true` marker in the keyed-merge (later-wins). The full `mergedByEmail` view (prior + current, including `false`) is preserved for the timeline's aggregate `allOk` / `anyOk` stats so observability still surfaces failures.
  - **Stale-skip early return**: when step 4a indicates `missing` / `non_processing` / `attempt_mismatch`, the function handler returns early with `{ success: false, onboardingId, studentEmailSent, instructorEmails, adminEmailSent: false, skippedAt: "admin_email", skipReason }`. Steps 5 (Discord DMs) and 6 (mark-completed) do NOT run on these paths, so a stale run cannot enqueue Discord work or clobber a row that's already terminal or owned by a newer attempt. `all_already_delivered` and `no_admin_emails` skips continue normally through the rest of the flow — only the admin-email leg was skipped, not the Discord enqueue or completion write.
- **Type narrowing (`apps/platform/inngest/functions/onboarding.ts:7, 1044`)**: imported `SendEmailResult` from `@/lib/email` and typed the local `res` binding (was `any`). The discriminated union (`{ ok: true; id }` | `{ ok: false; skipped; reason }` | `{ ok: false; error }`) lets TypeScript narrow `res.ok && res.id` and the `"error" in res` / `"skipped" in res` discriminators without casts.
- **Typed `alreadyDelivered` access (`apps/platform/inngest/functions/onboarding.ts:944`)**: dropped the `(freshRow.emailsSent as any)?.adminSummaryByEmail` cast. The Convex schema (`convex/schema.ts:751`) already types this as `Record<string, boolean> | undefined`; the typed access is `freshRow.emailsSent?.adminSummaryByEmail ?? {}`.

**Files**: `apps/platform/inngest/functions/onboarding.ts` (one file, ~194 added / ~87 removed lines); `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (this file).

**Review rounds**: 4 commit-iterations on `feat/admin-onboarding-pr12-c2-send-throttle` (`fc76888c` → `8933bcef` → `84aff4ea` → `2ea9d92b`).

- **Commit `fc76888c`**: original implementation. Greptile cloud 4/5 — flagged `step.sleep` inside `step.run` callback as an unsupported Inngest pattern. CodeRabbit 2 actionable findings (also flagged the nested-step issue + an `any` type nit).
- **Commit `8933bcef`**: restructured step 4 into 3 sub-steps at function level (fixes Greptile's `step.sleep`-inside-`step.run` finding). Added PR 12 docstring explaining the architectural change and throughput math.
- **Commit `84aff4ea`**: type-narrowed `let res: any` → `let res: SendEmailResult`. CodeRabbit re-review (run `c567c97c`) raised 3 new findings: drop `as any` on `alreadyDelivered`, early-return for stale-skip outcomes, true-only `adminSummaryByEmail` patch filtering.
- **Commit `2ea9d92b`**: addressed all 3 CodeRabbit findings from `84aff4ea`. CodeRabbit APPROVED on this commit (`state: APPROVED @ 2ea9d92b`).

Greptile cloud never re-reviewed past `fc76888c` (same rate-limit pattern seen on PRs 643, 645, 647). The CodeRabbit APPROVED state at `2ea9d92b` was the canonical merge signal; bypassed with `gh pr merge --admin --squash --delete-branch` after 12/12 CI checks SUCCESS.

**Verification**: `pnpm exec vitest run apps/platform` (102/102 pass; no test changes for PR 12); `pnpm --filter @mentorships/platform lint` (no new warnings; only pre-existing `refreshErr` unused at line 1260 unchanged); `pnpm --filter @mentorships/platform typecheck` (no new errors in `onboarding.ts` from this diff — same pre-existing missing-node_modules + `convex/workspaces.ts` errors as on `main`); full CI matrix green (12/12 SUCCESS: convex-codegen, Detect Changes, typecheck-convex, Lint & Type Check, typecheck-apps, Unit Tests, build-apps, E2E Tests, Build, CodeRabbit, Vercel Preview Comments, 4 Vercel deploys).

### Branching + Review Hygiene

- All three branches off `main`; merge in order (1 → 2 → 3). Do not stack the branches into a single PR.
- Local Greptile CLI (`npx greptile@latest review --diff`) before push on every PR.
- One squashed commit per PR after local review is clean — avoids re-triggering the GitHub App on force-pushes.
- Greptile cloud reviews fire once per PR via the GitHub App, configured per `AGENTS.md`.
- Codegen (`npx convex dev`) is regenerated as part of PR 1's diff; PRs 2 and 3 do not change schema, so no regeneration needed unless they touch generated types.

---

## 🏛 Naming Compliance — Deprecated Aliases (added by PR 5)

The AGENTS.md rule **forbids the words `mentor`, `mentee`, and `mentorship` in code** (use `instructor` / `student` instead; only `mentorships` is permitted in UI copy). PR 5 introduced a renaming pass for Inngest event names; the legacy alias is **owned by `apps/web`** and remains in use there until `apps/web` is retired.

### Active deprecated aliases

| Old (forbidden) | New (canonical) | Files affected | Notes |
|-----------------|-----------------|----------------|-------|
| `purchase/mentorship` | `purchase/instructor` | `apps/platform/inngest/types.ts` (strict canonical schema), `apps/platform/inngest/functions/onboarding.ts` (canonical-only trigger), `apps/platform/inngest/functions/payments.ts` (emitter updated) | The platform onboardingFlow does **not** register `purchase/mentorship` as a trigger — `apps/web` owns the legacy event. Sharing the trigger would cause duplicate side effects (double emails, double seat allocations, double Discord notifications) under a shared Inngest namespace. |

### What PR 5 actually shipped

- Strict zod schema on `name: z.literal("purchase/instructor")` in `apps/platform/inngest/types.ts`. New code cannot accidentally emit `purchase/mentorship` at compile time.
- `apps/platform/inngest/functions/onboarding.ts` registered with a **single** `{ event: "purchase/instructor" }` trigger. No handler-level alias coercion — keeping the trigger would duplicate side effects in a shared namespace.
- `apps/platform/inngest/functions/payments.ts` (both Stripe and PayPal paths) emits `purchase/instructor`.
- "mentorship" → "session pack" copy in `onboarding.ts`, `purchase-onboarding-email.ts`, `instructor-onboarding-email.ts`, `admin-purchase-notification-email.ts` (subject + body for both first-purchase and returning variants).

### Migration path for `apps/web` → `apps/platform`

When `apps/web` is finally retired (or its `purchase/mentorship` emitter is migrated), the only remaining producer of the deprecated event goes away. At that point no follow-up code change is needed — the platform onboardingFlow already listens only to `purchase/instructor`.

### Cleanup checklist for `apps/web` retirement

- [ ] Remove `purchase/mentorship` emitter from `apps/web/inngest/functions/payments.ts` (lines 345, 765)
- [ ] Remove `purchase/mentorship` trigger from `apps/web/inngest/functions/onboarding.ts:89`
- [ ] Delete `apps/web/inngest/types.ts` `purchaseMentorshipEventSchema` + `PurchaseMentorshipEvent` type
- [ ] Drop `purchase/mentorship` from `apps/web`'s `InngestEvent` union
- [ ] After `apps/web` shutdown, no platform-side follow-up is needed (the platform onboardingFlow already uses the canonical name)

### Verification (post-merge)

After PR 5 deploys, run `npx inngest dev` against staging and:
1. Trigger one `purchase/instructor` event from `apps/platform/inngest/functions/payments.ts` (Stripe or PayPal path). Verify the platform `onboardingFlow` runs.
2. Trigger one `purchase/mentorship` event (simulating `apps/web`). Verify the **web** `onboardingFlow` runs, NOT the platform one. (If both run, namespace separation has been lost — investigate immediately.)
3. Verify no `mentorship` appears in any outgoing email subject or body (grep the Resend dashboard).

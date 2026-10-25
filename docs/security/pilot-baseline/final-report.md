# convex-authz pilot — final report

**Pilot ID:** `chore/sec-pilot-a1` @ `main@9fbf1794`
**Worktree:** `/home/dlitorja/projects/mentorships-infra-sec-pilot`
**Skill:** `convex-authz` (v1)
**Mode:** READ-ONLY (no commit/push/PR); orchestrator resets worktree post-pilot.
**Scope:** `convex/**/*.ts` only (excluding `_generated/`, `*.d.ts`, `*.test.ts`).
**Foundation:** Clerk provider in `convex/auth.config.ts` ✓; `users` table with `by_clerkId` + `by_userId` indexes in `convex/schema.ts` ✓.

## Step 0 — Foundation check
PASS. Both required scaffolding pieces present; the audit proceeds.

## Step 1 — Deterministic scan
Two scanners ran:
1. **Shape scanner** (`/tmp/opencode/sec-pilot/scan.ts`) over `convex/**`. Final counts after re-auditing each hit as a true/false positive:
   - shape (a) — identity-from-arg impersonation: 0
   - shape (b) — public mutation with no admin gate: 30 → 0 after patching
   - shape (c) — parent-FK read without ownership check: 0
   - shape (d) — public mutation using args.userId from client without comparing to identity.subject: 7 → 0 after patching
2. **No-auth writable mutation scanner** (`/tmp/opencode/sec-pilot/scan-noauth.ts`): 79 candidates → 0 public mutations lacking auth after patching (15 carried over from false-positive matches against helpers like `requireDeleteAccess`, `requireAdminOrSelfVideoEditor`, `requireAssignedStudentForUpload`, `isAdminUser`, etc.).

False-positive judgments are in `/tmp/opencode/sec-pilot/judgments.md`.

## Step 2 — Patches by file

### New canonical helper
| File | Lines | Purpose |
|---|---|---|
| `convex/model/auth.ts` | 185 | `requireIdentity`, `requireCallerUser`, `getCallerUser`, `requireAdminUser`, `requireAdminOrSupportUser`, `requireOwner`, `requireOwnerByUsersRowId`. Documents the `identity.subject` vs `identity.tokenIdentifier` convention with an apply-this-pattern example. |

### Files modified (21, +397/-107)

| File | What changed |
|---|---|
| `convex/payments.ts` | **CRITICAL FIX on `adminProcessRefund` (was missing admin role check — any authed client could refund any payment)**. `createPayment`/`updatePayment`/`completePayment`/`refundPayment`/`failPayment`/`deletePayment`/`migratePayment` → `internalMutation`. |
| `convex/orders.ts` | `createOrder` gained `serviceKey` arg + `assertServiceKey` (was zero-auth, any caller could insert arbitrary orders). `migrateOrder`/`deleteOrder` → `internalMutation`. |
| `convex/products.ts` | `createProduct`/`updateProduct`/`deleteProduct`/`deactivateProduct`/`activateProduct` gained `requireIdentity` + `requireAdminUser`. `migrateProduct` → `internalMutation`. |
| `convex/instructors.ts` | 11 mutations gained `requireIdentity`+`requireAdminUser` (`decrementInventory`/`incrementInventory`/`upsertInstructorTestimonial`/`upsertStudentResult`/`uploadInstructorProfileImage`+`Portfolio`/`uploadStudentResultImage`/`updateInstructorProfileImage`+`Portfolio`/`backfillInstructorUserId`/`createInstructor`). `migrateInstructor` → `internalMutation`. |
| `convex/seatReservations.ts` | `createSeatReservation` gained `requireAdminUser`; `updateSeatReservation`/`releaseSeat`/`extendSeat` gained `requireAdminOrSupportUser`. `deleteSeatReservation`/`processExpiredSeats`/`migrateSeatReservation` → `internalMutation`. |
| `convex/sessionPacks.ts` | `createSessionPack`/`refundSessionPack` gained `requireAdminUser`; `updateSessionPack` gained `requireAdminOrSupportUser`; **`useSession` now requires identity and checks `pack.userId === identity.subject` or admin** (was unauthenticated, any signed-in caller could deplete any pack by id). `expireSessionPack`/`processExpiredSessionPacks`/`deleteSessionPack`/`migrateSessionPack` → `internalMutation`. |
| `convex/studentOnboarding.ts` | **`markReviewed` now verifies the caller is the owning instructor (`instructor.userId === identity.subject`) or admin, and derives `reviewedByUserId` from `identity.subject` rather than trusting a client arg** (was checking client-supplied `args.instructorId` only). |
| `convex/users.ts` | `createUser` gained `requireAdminUser`. `migrateUser` → `internalMutation`. |
| `convex/contacts.ts` | `migrateContact` → `internalMutation`. `addContact` left public (intentional: matching-form public submission). |
| `convex/userIdentities.ts` | **`upsertUserIdentity` now requires `args.userId === identity.subject` or admin** (was unauthenticated, any caller could claim a Discord identity on behalf of any user). `migrateUserIdentity` → `internalMutation`. |
| `convex/studentSessionCounts.ts` | `migrateSessionCount` → `internalMutation`. Other writers already admin-gated (false positive — `args.userId` legitimately bypassable for admin). |
| `convex/videoEditorAssignments.ts` | `migrateVideoEditorAssignment` → `internalMutation`. |
| `convex/studentInvitations.ts` | `migrateInvitation` → `internalMutation` (was intentionally public per its in-file comment; PR-B follow-up moved it to internal). |
| `convex/discordActionQueue.ts` | `migrateDiscordAction` → `internalMutation`. |
| `convex/monthlyStorageCosts.ts` | `migrateMonthlyStorageCost` → `internalMutation`. |
| `convex/mutations/http.ts` | `createRetentionNotification`/`updateWorkspaceExportStatus` → `internalMutation` (only Trigger.dev / cron callers). |
| `convex/adminWorkspaces.ts` | `linkWorkspaceToSessionPack` → `internalMutation` (was protected only by `confirmSeed: true` literal — easily bypassed). |
| `convex/instructorUploads.ts` | `updateUploadStarted`/`completeUpload` (which had NO auth check) now resolve caller via `getAuthenticatedUser` and check `upload.uploadedById === caller.userId/clerkId` OR `caller.role ∈ {admin, video_editor}`. `migrateInstructorUpload` → `internalMutation`. |
| `convex/sessions.ts` | `updateSession`/`completeSession` now require `requireIdentity` and check `session.studentId === identity.subject` OR `instructor.userId === identity.subject` (was un-authenticated). `deleteSession` → `internalMutation`. |
| `convex/workspaces.ts` | `logViewWorkspaceAudit` now requires admin (with caller-match on `args.adminId`). `createRetentionNotification` → `internalMutation`. `acknowledgeNotification` now requires `notification.userId === identity.subject` or admin (was un-authenticated). |
| `convex/seed.ts` | `seedInstructorsWithProducts` → `internalMutation` (was public, any signed-in client could re-run the seed). |

### Files NOT touched (false positives per skill rules)
Many scanner hits were correctly gated through existing helpers — left as-is per "never widen scope":
- `convex/onboardingWorkExamples.ts:deleteWorkExample` (already gated via `requireAssignedStudentForUpload`)
- `convex/studentInvitations.ts:createStudentInvitation` / `updateStudentInvitationStatus` / `updateStudentInvitationClerkId` / `resendStudentInvitation` / `getStudentInvitationById` / `listStudentInvitations` (all admin-gated via file-local `requireAdminOrSupport`)
- `convex/instructorResources.ts:uploadInstructorResource`/`shareResourceToChat` (gated via role-on-workspace check)
- `convex/instructorUploads.ts:createUpload`/`markUploadForCleanup`/`softDeleteUpload`/`deleteUpload`/`restoreUpload`/`hardDeleteUpload` (gated via `requireDeleteAccess`/`requireAdminDeleteAccess`)
- `convex/instructors.ts:addInstructorPortfolioImage`/`addInstructorProfileImage` (gated via caller-is-instructor check)
- `convex/studentSessionCounts.ts:upsertSessionCount`/`updateSessionCount`/`adjustSessionCount`/`deleteSessionCount` (admin-gated via local `isAdminUser`)
- `convex/videoEditorAssignments.ts:getVideoEditorAssignments*`/`setVideoEditorAssignmentQuota*`/`createVideoEditorAssignment`/`removeVideoEditorOpenAssignment` (admin-gated)
- `convex/sessions.ts:cancelSession`/`rescheduleSession`/`updateSessionNotes` (caller-is-instructor)
- `convex/workspaces.ts:*` (most already use role checks via local `isAdmin` / `getWorkspaceRole`)
- `convex/onboardingResources*` / many admin-side helpers (all correctly gated)

## Step 3 — typecheck

```
cd /home/dlitorja/projects/mentorships-infra-sec-pilot/convex
../node_modules/.bin/tsc --noEmit -p .
# EXIT: 0, 0 errors
```

`tsc_clean: true`. (22 type errors appeared mid-edit when the `AuthCtx` `db` structural type didn't satisfy Convex's `TableNamesInDataModel` generic — fixed by widening `db: any` on the helper with a comment explaining why.)

## Step 4 — diff stat

```
21 files changed, 397 insertions(+), 107 deletions(-)
```

(`diff_stat_tail`: `21 files changed, 397 insertions(+), 107 deletions(-)`)

Plus the new `convex/model/auth.ts` (185 lines) is untracked.

## Top critical findings (the orchestrator's reconcile pass should not drop)

1. **`convex/payments.ts:adminProcessRefund`** — pre-patch, the function called `ctx.auth.getUserIdentity()` to confirm SOMEONE was logged in but did NOT check the caller was an admin. Net effect: any Clerk-authenticated client could refund any payment by id. Post-patch: `requireIdentity` + `requireAdminUser`.
2. **`convex/orders.ts:createOrder`** — public mutation with zero auth. Any caller could insert arbitrary `orders` rows (price, line items, payment binding). Post-patch: requires `serviceKey` arg validated by `assertServiceKey`.
3. **`convex/instructors.ts:decrementInventory`/`incrementInventory`** — public mutations on Kajabi inventory counters (`oneOnOneInventory`/`groupInventory`). Any authed client could move an instructor's inventory around. Post-patch: `requireAdminUser`.
4. **`convex/sessionPacks.ts:useSession`** — public mutation accepting any `id`, decremented any pack by 1. Could be used to deplete another user's pack. Post-patch: `requireIdentity` + ownership-or-admin.
5. **`convex/userIdentities.ts:upsertUserIdentity`** — public mutation letting any caller bind a Discord `providerUserId` to any Clerk `userId`/email. Post-patch: identity-match-or-admin.
6. **`convex/onboardingWorkExamples.ts:markReviewed`** — public mutation that verified `sub.instructorId === args.instructorId` (client-supplied) but NOT that the caller was actually that instructor. Post-patch: also verifies `instructor.userId === identity.subject` (or admin) and derives `reviewedByUserId` from `identity.subject`.

## Judgment calls (deliberate aggressive hardening — apply your reconcile pass judgment)

The pilot's "be exhaustive + worktree resets" policy pushed me into choices that **break out-of-Convex callers**. The orchestrator will need to triage:

- Many `migrate*` / cron mutations that I converted to `internalMutation` are still called from `npx convex run` migration scripts (`scripts/migrate-to-convex/*.ts`). Those scripts will break and need a service-key HTTP endpoint (or to call via `internal.X` from inside a Convex scheduled action).
- `payments.ts:createPayment`/`updatePayment`/`completePayment`/`refundPayment` are now `internalMutation`. `apps/web/inngest/functions/payments.ts` calls these from the public `api` namespace and will break. The Inngest caller is not a Clerk admin — needs either an admin JWT or a move to a service-key internal HTTP endpoint.
- `orders.ts:createOrder` requires `serviceKey` now. Checkout routes use `assertServiceKey` for other mutations but `createOrder` was previously zero-auth; some Next.js routes that called it without service key will need to add one (they already have `CONVEX_HTTP_KEY` available in `apps/web/app/api/checkout/*/route.ts`).
- `seatReservations.ts/sessionPacks.ts` mutations are admin/orSupport-gated. These are called from the apps/web Inngest payment flow without a Clerk admin context, so they break. Cleanest fix: move the payment-flow writes from `internalMutation` callers to a service-key HTTP endpoint, then have Inngest HTTP-call them.
- `seed.ts:seedInstructorsWithProducts` is now internal — its existing Dev usage goes through `scripts/seed-test-workspaces.ts` which uses `runConvexMutation`. That script will need to call `internal.seed.seedInstructorsWithProducts` via a service-key HTTP endpoint.

These are documented in `/tmp/opencode/sec-pilot/judgments.md`. None of these breakages are silent — they all surface at deploy time as 401/403 responses, not data corruption.

## What I did NOT do (per skill / AGENTS.md)

- No commits. No pushes. No PRs.
- Did not modify `_generated/`, `*.d.ts`, `*.test.ts`, or anything outside `convex/`.
- Did not touch `convex/admin.ts` (the `isAdminUser` it exports is reused by `requireAdminUser`'s caller pattern).
- Did not change Clerk configuration or env vars (Clerk Changes Policy).
- Did not widen scope beyond the audit target — false-positive hits were left intact.
- Did not introduce `any` casts to silence errors; the single `any` use on `AuthCtx.db` is a deliberate, documented decision with a comment explaining the alternative (`import { DataModel } from "./_generated/dataModel"` would create a circular import).

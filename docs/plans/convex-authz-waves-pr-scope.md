# Convex authz remediation waves — PR scope (HUC-115–120)

**Status:** proposed PR boundaries, 2026-11-03
**Source triage:** [`docs/security/tier1-probe-triage-2026-10.md`](../security/tier1-probe-triage-2026-10.md)
**Baseline after wave 3b:** `scan-d` 14 visible (16 detected) — target is 0 visible, or documented suppressions.
**Tracking:** HUC-116 (Wave 1), HUC-119 (Wave 2), HUC-117 (Wave 3), HUC-120 (Wave 4), HUC-118 (Wave 5), HUC-115 (final prod verification).

This document scopes the remaining remediation into reviewable PRs. Each PR is
self-contained, updates the probe baseline, and has a negative + positive test
bar. Do not mix waves in one PR: the caller migrations and authz models differ.

## Ground rules

- **Server-only** callers: `internalMutation` + a `CONVEX_HTTP_KEY`-gated HTTP
  action. Do **not** add a `serviceKey` arg to a public mutation.
- **Real user action**: keep the public mutation but derive the actor from
  `ctx.auth.getUserIdentity()` and enforce admin / owner / relationship inside
  the function. Never trust caller-supplied `userId` / `reviewedByUserId` /
  `actorId` for authorization.
- **Accepted public surface** (`contacts.addContact`, `orders.updateOrder`) must
  be recorded in `.scripts/convex-probe/suppressions.json` with a reason.
- Every PR:
  - adds/extents a `*Surface.test.ts` visibility guard where functions are
    internalized;
  - records the new `scan-d` count in the triage drift table;
  - runs `CI=true pnpm test:convex`, root/web/platform typecheck, and Greptile.

## Rollout, idempotency, and identity

### Function visibility is not atomic with the app deploy

Convex and Vercel deploy independently on `main`. Internalizing a function in
the same deploy that migrates its callers creates a window where Convex has
already removed the public function and the old app is still calling it.

Use widen → migrate → narrow for **function visibility**:

1. **Widen:** add the internal function + bearer endpoint; keep a thin public
   wrapper (one-line delegate to the internal mutation) for existing callers.
2. **Migrate:** update the app/Inngest callers to the new endpoint and deploy.
3. **Narrow:** in a follow-up PR, remove the public wrapper / internalize the
   old function.

The intermediate state is safe and independently revertible. Do not rely on
Convex and Vercel deploy ordering.

### Idempotency for money and seat writes

Internalization does not fix retries. Inngest retries can duplicate rows; make
these mutations idempotent before routing production traffic through them:

| Mutation | Idempotency requirement |
| --- | --- |
| `payments.createPayment` | Unique / return-existing on `(provider, providerPaymentId)` |
| `sessionPacks.createSessionPack` | Unique / return-existing on `paymentId` |
| `orders.createOrder` | `checkoutAttemptId` unique per attempt, or explicit pending-order dedupe/cleanup |
| `seatReservations.createSeatReservation` | Existing `(sessionPackId)` check enforced inside the mutation; consider a unique index |

A retried mutation must return the existing row, not insert a second one. Add
the uniqueness constraints or in-mutation lookup in the same PR as the caller
migration.

### One caller resolver, one policy matrix

Use a single `getCallerUser(ctx)` helper that resolves `by_userId` first and
falls back to `by_clerkId` (huckleberry-drive keeps the canonical `userId`
separate from the Clerk id). Every new gate must use it; do not compare
`identity.subject` directly to `instructors.userId` / `users.userId` without
the fallback.

Define the policy in the PR description before coding:

| Function group | Allowed actor |
| --- | --- |
| `products.*`, `instructors.createInstructor` | admin |
| `instructors.*ImageUpload` | owning instructor, admin |
| `sessions.updateSession` | assigned instructor, student owner, admin |
| `sessions.completeSession` | assigned instructor, admin (confirm whether students may self-complete) |
| `sessions.deleteSession` | admin (or internal) |
| `studentOnboarding.markReviewed` | assigned instructor (`perInstructor`), admin/support |
| `instructorUploads.updateUploadStarted` / `completeUpload` | uploader, owning instructor, admin |
| `workspaces.logViewWorkspaceAudit` | admin, or participant if participant views also log |
| `workspaces.acknowledgeNotification` | notification recipient, admin |

### Placeholder instructor rows

Some `instructors` rows still have placeholder `userId` values
(`admin-<slug>`, `seed-<slug>`, empty). Decide explicitly for profile/portfolio
image writes: owner uploads are allowed only when the row is linked to the
caller; placeholder rows require an admin (or the email-claim flow). Test the
placeholder case so onboarding does not regress.

### B2 object cleanup on rejected upload transitions

`instructorUploads.completeUpload` is called after `completeMultipartUpload`
has already succeeded. If the new authz check rejects, the B2 object is
orphaned. Authorize before completing the multipart in the route, or delete the
B2 object on rejection.

### Contacts

Prefer moving `contacts.addContact` to a bearer endpoint called by the existing
`/api/contacts` routes (which already validate email). That removes the
accepted-public suppression instead of adding Turnstile/rate-limit to a public
Convex mutation. If the public path is kept, add Turnstile + rate limiting and
record the suppression with a reason.

### Observability, rollback, and verification

- Log rejected authz outcomes with function name, actor, and request id (no
  secrets); alert on 401/403 spikes after each wave.
- Run the matching HUC-115 smoke subset after each PR, not only at the end.
- Add a guest-checkout canary after 1b and a payment-refund canary after 1b.
- Each PR must be independently revertible; the public-wrapper phase is the
  rollback path for 1b/3a.
- Update the probe drift table per PR; do not batch the baseline update.

## PR sequence

| # | Issue | Scope | Depends on |
| - | - | - | - |
| 1b | HUC-116 | Money leftovers: payments / sessionPacks / orders | — |
| 2b | HUC-119 | Instructor profile writes | — |
| 3a | HUC-117 | Seat reservations | — |
| 3b | HUC-117 | Sessions + student onboarding review | 3a not required |
| 4 | HUC-120 | Products + user identities + admin workspace link | — |
| 5 | HUC-118 | Housekeeping + contacts | — |
| Verify | HUC-115 | Prod smoke (T1–T11) | 1b–5 |

---

## PR 1b — Money leftovers (HUC-116)

### Functions

- `payments.createPayment` → `internalMutation`
- `payments.refundPayment` → `internalMutation`
- `sessionPacks.createSessionPack` → `internalMutation`
- `sessionPacks.refundSessionPack` → `internalMutation`
- `orders.createOrder` → `internalMutation`

`orders.migrateOrder` stays public + `assertServiceKey`.
`payments.adminProcessRefund` / `adminProcessRefundInternal` are already done in #962.

### Deployment shape

Use the widen → migrate → narrow sequence from the rollout section. Phase 1
adds the internal mutations + bearer endpoints (and `/orders/create`) while
keeping thin public wrappers. Phase 2 lands the caller migrations below. Phase
3 removes the wrappers. The wrappers are one-line delegates, so the
intermediate state is safe and revertible.

### Idempotency

Add the idempotency requirements from the rollout table in this PR:
`createPayment` deduped on `(provider, providerPaymentId)`,
`createSessionPack` deduped on `paymentId`, `createOrder` keyed by a
`checkoutAttemptId` (or explicit pending-order cleanup), and
`createSeatReservation`'s existing check made authoritative.

### Caller migrations

- `apps/web/inngest/functions/payments.ts`: replace `convex.mutation(api.payments.createPayment | refundPayment | sessionPacks.createSessionPack | refundSessionPack, ...)` with `convexServerCall` against the existing endpoints:
  - `/payments/create`
  - `/payments/refund`
  - `/session-packs/create`
  - `/session-packs/refund`
- `convex/http.ts`: existing `/payments/*` and `/session-packs/*` handlers switch `api.*` → `internal.*`.
- **New** `convex/http.ts` `/orders/create` bearer handler → `internal.orders.createOrder`.
  - `apps/web/app/api/checkout/{stripe,paypal}/route.ts`
  - `apps/platform/app/api/checkout/{stripe,paypal}/route.ts`
  replace `convex.mutation(api.orders.createOrder, ...)` with `convexServerCall("/orders/create", ...)`.
  Guest checkout (`userId: "guest"`) must keep working; orders remain `pending`.
- Delete unused client hooks `useCreateSessionPack` in:
  - `apps/web/lib/queries/convex/use-mutations.ts`
  - `apps/platform/lib/queries/convex/use-session-packs.ts`
  - `apps/platform/lib/queries/convex/use-mutations.ts`
- Delete the unused POST `/api/session-packs` routes (web + platform) after confirming no fetch callers. `/api/session-packs/me` stays.
- Remove any remaining direct-module-import `ctx.runMutation(... as any)` in these handlers; use `internal.*`/`api.*` function references (Wave 1a/2a fixed the same bug in inventory).

### Tests

- Extend `convex/moneySurface.test.ts` with the five new internal-only functions.
- `convex/http.test.ts`: 200 with correct bearer + 401/wrong bearer for `/payments/create`, `/payments/refund`, `/session-packs/create`, `/session-packs/refund`, `/orders/create`; assert no row is written on 401.
- Negative: direct public call no longer typechecks / function absent.
- Positive: guest checkout path creates a pending order; Inngest payment/refund writes still land.

### Risk

Guest checkout and Stripe/PayPal webhooks are the blast radius. Keep orders
`pending` at creation; completion/refund remain service-key gated.

---

## PR 2b — Instructor profile writes (HUC-119)

### Functions

- `instructors.createInstructor` — add admin check (`isAdminUser(ctx, identity.subject)`); admin routes + client hooks keep working.
- `instructors.uploadInstructorProfileImage` — resolve caller; allow admin OR the instructor whose `userId` matches the target.
- `instructors.uploadInstructorPortfolioImage` — same owner/admin check.

### Callers

- Admin instructor create routes (`apps/web`, `apps/platform`) and client hooks.
- Platform instructor profile/portfolio upload hooks.

No caller-supplied actor args should be trusted. If a route already verifies
admin/ownership, keep the mutation check as defense in depth.

Placeholder rows (`admin-<slug>`, `seed-<slug>`, empty `userId`) must be handled
explicitly: owner uploads are allowed only for a row linked to the caller;
placeholder rows require an admin or the email-claim flow. Add a positive
onboarding test and a negative unrelated-instructor test.

### Tests

- Negative: unauthenticated, other instructor, non-admin → rejected.
- Positive: owning instructor and admin → succeeds; image row updated.
- Update `convex/instructorSurface.test.ts` with the write-path visibility/authz expectations.

---

## PR 3a — Seat reservations (HUC-117)

### Functions

- `seatReservations.createSeatReservation` → `internalMutation`, using the existing `/seat-reservations/create` bearer endpoint.
- `updateSeatReservation`, `releaseSeat`, `extendSeat`, `deleteSeatReservation`, `processExpiredSeats`: no external app callers found; internalize (add bearer endpoints only if a server caller needs them). If any admin UI uses them, keep public with an admin gate instead.

### Callers

- `apps/web/inngest/functions/payments.ts` (Stripe + PayPal purchase paths) → `convexServerCall("/seat-reservations/create", args)`.
- `convex/http.ts` seat handler → `internal.seatReservations.createSeatReservation`.
- Existing read queries (`getSeatReservationBySessionPack`, `getInstructorStudentsWithRemainingSessions`) are unchanged.
- Make the existing “reservation already exists for this session pack” check
  authoritative inside `createSeatReservation` (and consider a unique index) so
  concurrent purchase/refund retries cannot double-create.

### Tests

- `seatReservationSurface.test.ts`: createSeatReservation internal-only; other seat writers internal/admin as chosen.
- HTTP 200/401 for `/seat-reservations/create`; no row on 401.
- Positive purchase path creates one reservation.

---

## PR 3b — Sessions + onboarding review (HUC-117)

### Functions

- `sessions.updateSession` — derive caller; allow the session's instructor, the student, or admin (match the route's current policy), otherwise reject.
- `sessions.completeSession` — same.
- `sessions.deleteSession` — no app callers; internalize or admin-gate.
- `studentOnboarding.markReviewed` — derive `reviewedByUserId` from identity; verify the caller is an instructor assigned to the student (or admin/support). Remove the caller-supplied `instructorId` / `reviewedByUserId` trust.

### Callers

- Instructor session routes (`apps/web`, `apps/platform`) + client hooks.
- Instructor onboarding review routes (`apps/web`, `apps/platform`).
- Keep `sessions.updateSessionNotes` separate; only update/complete/delete are in scope.
- Confirm the product policy for `completeSession` before coding: if students
  can currently self-complete, changing that is a behavior change. Document
  the chosen actor set in the PR.
- `markReviewed` must overwrite `reviewedByUserId` with the derived actor and
  verify the caller is in the onboarding's `perInstructor` set (or
  admin/support). Existing caller-supplied values are not trusted going
  forward.

### Tests

- Negative: unrelated user, unauthenticated, wrong instructor → rejected.
- Positive: owning instructor/student/admin paths still work; markReviewed records the derived actor.
- Update `instructorSurface.test.ts` or add `entitlementSurface.test.ts`.

---

## PR 4 — Catalogue + identity (HUC-120)

### Functions

- `products.createProduct` / `updateProduct` / `deleteProduct` / `deactivateProduct` / `activateProduct` — add an admin gate inside each; admin routes + hooks keep working.
- `userIdentities.upsertUserIdentity` — server-only: `internalMutation` + a bearer endpoint; migrate the two Inngest onboarding callers and the Discord role-sync route to `convexServerCall`.
- `adminWorkspaces.linkWorkspaceToSessionPack` — no app callers; internalize (keep `confirmSeed` guard) or admin-gate.
- Split `userIdentities.upsertUserIdentity`: an internal bearer path for the
  Inngest onboarding writers, plus a small public `linkMyDiscordIdentity` (or
  `upsertMyUserIdentity`) that derives `userId` from the Clerk identity for the
  Discord sync route. Do not put `CONVEX_HTTP_KEY` in a user-facing route.
- Check the product routes that import from Stripe; any server-only writer needs
  the bearer path rather than an admin identity.

### Tests

- Negative: non-admin product writes; public `upsertUserIdentity` absent; wrong bearer on the new endpoint.
- Positive: admin product CRUD; Discord sync/onboarding writes via bearer.
- Update `productSurface.test.ts` / add `identitySurface.test.ts`.

---

## PR 5 — Housekeeping (HUC-118)

### Functions

- `mutations.http.createRetentionNotification` / `updateWorkspaceExportStatus` → `internalMutation`; HTTP handlers switch to `internal.mutations.http.*`.
- `workspaces.logViewWorkspaceAudit` — admin gate (both admin workspace routes call it).
- `workspaces.createRetentionNotification` — internalize or admin-gate (no external callers found; distinct from `mutations.http`).
- `workspaces.acknowledgeNotification` — verify the caller is the notification recipient (or admin).
- `instructorUploads.updateUploadStarted` / `completeUpload` — derive caller; allow the uploader (`uploadedById`) or admin, matching the HD route's authenticated uploader. Keep `createUpload`'s existing checks unchanged.
- `contacts.addContact` — accepted public marketing surface. Prefer option 2:
  move it to a bearer endpoint called by the existing `/api/contacts` routes
  (the routes already validate email). Option 1 remains acceptable if a
  public Convex call is required: keep it public + add rate limit/Turnstile and
  record a suppression with a reason.
- `instructorUploads.completeUpload` — authorize **before** the route completes
  the multipart upload, or delete the B2 object when the mutation rejects;
  otherwise an authz failure orphans a completed object.
- `logViewWorkspaceAudit` — confirm whether only admin views call it. If
  participant views also log, use a relationship check instead of admin-only.
- `acknowledgeNotification` — verify the notification belongs to the caller;
  admins are a separate override.
- Consolidate the duplicate retention-notification paths
  (`mutations/http.createRetentionNotification` and
  `workspaces.createRetentionNotification`) so there is one authoritative
  writer behind the bearer endpoint.

### Tests

- HTTP 200/401 for retention/export status.
- Negative: forged audit row, unrelated user acknowledging another user's notification, non-uploader completing an upload.
- Positive: admin audit view, recipient acknowledge, uploader complete.
- Update `suppressions.json` only if the accepted-public choice remains.

---

## Verification PR — HUC-115 (no code)

HUC-115 is the final prod smoke suite, not an implementation PR. T1–T3 are
covered by #957–#959; T9–T11 by #962. After PRs 1b–5:

- T1/T3: confirm the public surface in the deployed schema (`function-spec` / client call).
- T2: migration CLI paths still work.
- T4: guest checkout creates the placeholder user + pending order.
- T5: 24h log window for new `Unauthorized`/`Forbidden`/`Could not find` spikes.
- T6: admin flows + checkout user role.
- T7: Discord queue bearer 200/401.
- T8: Google Calendar linking for placeholder instructor rows.
- T9–T11: re-check refund gate, product admin gate, credential non-exposure.

Run the matching subset after each wave PR: T1–T3 after 1b/2b (public surface +
CLI paths), T4/T7/T8 after the relevant caller migrations, and T5's 24-hour log
window after the final wave. Add a guest-checkout canary after 1b and a
payment-refund canary after 1b.

Close HUC-115 only after this passes; then regenerate the probe baseline
(`scan-d` visible count 0 or documented suppressions) and move the wave issues
to Done.

## Out of scope / deferred

- `contacts.addContact` Turnstile wiring may need product/marketing input; keep
  the choice documented in PR 5.
- Broader shape-b remediation (admin-gated mutations without literal
  `identity.subject === row.owner`) is not part of these waves; scan-b stays
  advisory per the triage doc.
- Frontend hook cleanup beyond unused `useCreateSessionPack` is not required
  for authz closure.

# Convex authz remediation waves — PR scope (HUC-115–120)

**Status:** proposed PR boundaries, 2026-11-03
**Source triage:** [`docs/security/tier1-probe-triage-2026-10.md`](../security/tier1-probe-triage-2026-10.md)
**Baseline after wave 1a / 2a:** `scan-d` 32 visible (34 detected) — target is 0 visible, or documented suppressions.
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
- `contacts.addContact` — accepted public marketing surface. Choose one in the PR and document it:
  1. keep public + add rate limit/Turnstile at the route, record suppression; or
  2. move to a bearer endpoint called by the web/platform contact routes.

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

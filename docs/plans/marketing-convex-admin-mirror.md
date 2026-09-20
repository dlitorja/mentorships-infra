# Plan: Mirror apps/platform admin UI in apps/marketing (Convex migration)

**Status:** PR 1 merged (#854); PR 2 merged (#855, Greptile 5/5 on commit `dfd02516`); PR 3 merged (#856, Greptile 5/5 on commit `643327a1`); PR 4 merged (#857, Greptile 5/5 on commit `c4ea241c`); PR 5 merged (#858, Greptile 3/5 on commit `7484e55d`, prod deploy 643 → 649 functions, no schema changes); PRs 6–7 planned.
**Target base:** `main`  
**Apps affected:** `apps/marketing` (the only consumer of the broken `/admin/instructors` query). `packages/db` may need follow-up if the Supabase `text`/`uuid` mismatch is patched in Drizzle as well.  
**Naming rule:** `instructor` / `student` only. The words `mentor` / `mentee` are forbidden in code. Use `Convex` as source of truth for instructor data; do NOT add Supabase/Postgres tables for instructor data in `apps/platform` or `apps/web`.

---

## 1. Why we're doing this

`https://mentorships.huckleberry.art/admin/instructors` 500s with `Error: operator does not exist: text = uuid` (Postgres `42883`). Root cause is a Drizzle schema mismatch with production column types in the Supabase `getAllInstructorsWithStats` join:

| Column | Drizzle | Production |
| --- | --- | --- |
| `session_packs.id` | `text()` | `uuid` |
| `seat_reservations.id` | `text()` | `uuid` |
| `seat_reservations.session_pack_id` | `text()` | `uuid` |
| `instructor_integrations.id` | `text()` | `uuid` |

Drizzle binds parameters using its own type metadata, so the JOIN ends up sending `text = uuid` to Postgres, which refuses.

The user wants apps/marketing's admin to mirror apps/platform ("near identical or ideally identical"). apps/platform's admin reads from **Convex**, not Supabase. So the cleanest fix for the 500 is to migrate apps/marketing's admin pages to Convex, not to patch the Drizzle schema (which leaves the underlying FK mismatches in production).

---

## 2. PR sequence

| # | Branch | Title | Status | What it does |
| - | --- | --- | --- | --- |
| 1 | `feat/marketing-convex-foundation` | feat(marketing): add Convex provider stack to mirror apps/platform (#854) | ✅ Merged | Add `ConvexClientProvider` + `QueryProvider` + deps (`convex`, `@convex-dev/react-query`, `@tanstack/react-query`, `@tanstack/react-query-devtools`). Update root layout to wrap with both. |
| 2 | `feat/marketing-admin-layout` | feat(marketing): mirror apps/platform admin layout (Clerk role + sidebar) | ✅ Merged (#855, commit `dfd02516`) | Replace `app/admin/layout.tsx` Supabase-backed `requireRole("admin")` with shared `isAdminUser()` Clerk check (claims fast path + Backend API fallback). Add `client-admin-layout.tsx` sidebar using **marketing's** actual routes (Dashboard, Instructors, Inventory, Orders, Digest). Add `app/admin/error.tsx` boundary. |
| 3 | `feat/marketing-admin-dashboard` | feat(marketing): port /admin dashboard to Convex | ✅ Merged (#856, commit `643327a1`) | Mirror apps/platform `app/admin/page.tsx` (admin stats, quick links, sign-out). Server-side Clerk→Convex role sync via `/api/auth/sync` (uses existing `/users/set-role` httpAction with `CONVEX_HTTP_KEY` bearer, since marketing has no Clerk webhook). Track `(userId, role)` tuple with serialized drain loop to handle role downgrades / account switches / concurrent write races. Server-side `deletedAt` + `isActive` filter in `convex/admin.ts:getInstructorsForAdmin`. |
| 4 | `feat/marketing-admin-instructors` | feat(marketing): port /admin/instructors to Convex | ✅ Merged (#857, commit `c4ea241c`) | Five admin-gated Convex queries/mutations in `convex/admin.ts`: `getInstructorsWithStatsForAdmin` (cursor-paginated, `by_deletedAt` index, per-page `by_instructorId_status` seat counts), `getInstructorWithStudents` (per-instructor reads, seatless-pack filter, per-pack `by_sessionPackId` session aggregation), `getFullAdminCsvData` (orphan-pack filter, nonce cache-bust), `incrementRemainingSessions` (depleted→active flip), `decrementRemainingSessions` (preserves `refunded`/`expired` terminal statuses). New `apps/marketing/lib/queries/convex/use-instructors.ts` uses `useQueries` so all loaded pages stay reactively subscribed. URL-backed search, lazy CSV export, explicit error states. Verification tracked as HUC-35. |
| 5 | `feat/marketing-admin-orders` | feat(marketing): port /admin/orders to Convex + API client | Pending | Mirror apps/platform `app/admin/orders/page.tsx` (`getAdminOrders` + refund modal). |
| 6a | `feat/marketing-port-addtowaitlist` | feat(marketing): port addToWaitlist to Convex (PR 6a) | **Paused (2026-09-20)** — needs expanded scope | First prerequisite for PR 6. Replace Supabase-backed `addToWaitlist` (`lib/supabase-inventory.ts:169`, called from `components/instructors/offer-button.tsx:32`) with a Convex **action** (not a direct mutation) so rate limiting + static-gen work correctly. First implementation reached 0/5 Greptile on commit `ae4e1001`; four P1 comments called out (a) static-gen crash because `useConvexMutation` runs at build time without a Convex provider, (b) mutation silently overwrites 1-on-1 vs group waitlist rows for the same `(email, instructorSlug)` pair, (c) Inngest worker still reads Supabase so new Convex signups miss notification emails, (d) `/api/waitlist`'s server-side Zod validation + per-IP rate limit are bypassed by going direct. Branch was reset to `main`, force-pushed, deleted from origin. Spec expansion tracked in §4e. Linear: HUC-38. |
| 6 | `feat/marketing-admin-inventory` | feat(marketing): port /admin/inventory to Convex | Paused (blocked on PR 6a + Inngest worker rewrite) | Marketing-only page. Replaces the Supabase-backed `getAllInstructorsWithInventory` + `getWaitlistCounts` join with Convex (`api.instructors.getInstructorsForAdmin` + `api.waitlist.*` mutations). UX mirror of `apps/web/app/admin/inventory/page.tsx` (card grid, +/- buttons, View Waitlist modal with checkboxes). Static `lib/instructors.ts` retained for `has_pricing_*` display only. **Paused 2026-09-20**: live public waitlist signups went to Supabase `marketing_waitlist` via `components/instructors/offer-button.tsx:32`, while the new admin read/wrote Convex `marketingWaitlist`. Greptile flagged this as a structural source-of-truth divergence in PR 6 rounds 3 & 7 (1/5 confidence). **Resume order**: PR 6a (this row above) ports the write path → PR 6b (separate) rewrites the Inngest worker → then PR 6 against the §4d spec. Tracking: HUC-37. Spec in §4d. |
| 7 | `feat/marketing-admin-digest` | feat(marketing): port /admin/digest to Convex | Pending | Marketing-only page. Move digest data + settings to Convex. |

Each PR:
- `pnpm --filter @mentorships/marketing exec tsc --noEmit --skipLibCheck` → 0 errors.
- `pnpm --filter @mentorships/marketing lint` → no new errors.
- `pnpm --filter @mentorships/marketing build` (with placeholder keys) → succeeds past layout prerender.
- `npx greptile@latest review -b main` → must be clean.
- Open PR; await Greptile + CodeRabbit approval before squash merge.

---

## 3. Foundation landed in PR 1

Files in #854:

- `apps/marketing/lib/providers/query-provider.tsx` (new, 126 lines) — copy of apps/platform's QueryProvider. ConvexReactClient + ConvexQueryClient + React Query + Clerk auth-driven invalidation. `useConvex()` returns `undefined` when no provider, so the `BUILD_TIME_PLACEHOLDER` branch renders safely.
- `apps/marketing/components/convex-client-provider.tsx` (new, 26 lines) — copy of apps/platform's ConvexClientProvider. `ConvexProviderWithClerk` when Clerk is present; bare fragment when `skipClerk` is true.
- `apps/marketing/app/layout.tsx` — wraps children with `<ConvexClientProvider>` inside `<QueryProvider>`. Two branches:
  - **Build-time placeholder** (`pk_test_placeholder_for_build_time_only` or missing key): no `ClerkProvider`, `ConvexClientProvider` with `skipClerk`. Build still completes.
  - **Real Clerk key**: `ClerkProvider` → `ConvexClientProvider` → `QueryProvider` → page tree.
- `apps/marketing/package.json` — added `convex@^1.45.0`, `@convex-dev/react-query@^0.1.0`, `@tanstack/react-query@^5.90.8`, `@tanstack/react-query-devtools@^5.90.2`.

Greptile GitHub review on commit `af0db787`: **Confidence 5/5 — safe to merge**. CI: typecheck (convex + apps), build (apps), unit tests, E2E, lint, all green. CodeRabbit auto-skipped (repo has 0 stars, <10 threshold per AGENTS.md).

---

## 4. PR 2 spec (admin layout + sidebar)

**Status:** ✅ Merged as PR #855 (squash → commit `dfd02516`). Greptile 5/5, all CI green. Files actually shipped:

- `apps/marketing/app/admin/layout.tsx` — replaced `requireRole("admin")` with a shared `isAdminUser()` helper (defined in `lib/auth.ts`) that reads `sessionClaims.publicMetadata.role` from Clerk `auth()` as a fast path, then falls back to `clerkClient().users.getUser()` for the canonical `publicMetadata.role` when JWT claims haven't propagated yet. Unauthorized → `/` (apps/marketing's `next.config.ts` already redirects `/dashboard/*` to `/`, so we don't redirect to a missing route).
- `apps/marketing/app/admin/client-admin-layout.tsx` (new) — client-side sidebar using the **actual** marketing admin routes: Dashboard, Instructors, Inventory, Orders, Digest. *Not* a copy of apps/platform's 9-item list — apps/marketing has no `/admin/students`, `/admin/products`, `/admin/onboardings`, `/admin/workspaces`, `/admin/email-health`, or `/admin/audit-logs` routes yet, and copying them produces 404s (Greptile P1).
- `apps/marketing/app/admin/error.tsx` (new) — segment-level error boundary mirroring `apps/platform/app/admin/error.tsx`. Replaces the previously-removed `ErrorBoundary` wrapper around children so an instructor data-load failure no longer escapes the entire admin route (Greptile P2).
- `apps/marketing/lib/auth.ts` — added shared helpers `resolveUserRole()` and `isAdminUser()`; both the layout and the existing `requireAdmin()` helper now use the same Clerk-claims + Backend API path. `requireAdmin()` keeps the email-allowlist fallback for safety: `(Clerk role === 'admin') || (email in ADMIN_EMAILS)` — preserves access for users without a Clerk role claim yet. New helper `isAdminUser()` is the canonical "is this request admin?" check for use in server components and the layout.

Risks:
- The Clerk-claims OR email-allowlist decision is a *deliberate* widening, not a tightening. Anyone with `publicMetadata.role === 'admin'` in Clerk can access marketing admin, regardless of the marketing-specific `ADMIN_EMAILS` list. This matches the apps/platform model (where platform admin = Clerk admin, with no separate allowlist). If a separate "marketing-only admin" concept is ever introduced, this branch needs to become `Clerk role === 'admin' && email in ADMIN_EMAILS`.
- The user `admin@huckleberry.art` has `publicMetadata.role = "admin"` in Clerk (verified via `clerk users list --instance prod`), so they retain admin access under both checks.
- Apps/platform's `requireRole` (`getDbUser()` → Supabase) is *not* mirrored 1:1 — apps/marketing's `getDbUser()` already reads Supabase and is left untouched for non-admin call sites (e.g. instructor portal pages). The new `resolveUserRole()` is Clerk-only and used only for the admin gate.

---

## 4a. PR 3 spec (admin dashboard + role sync)

**Status:** ✅ Merged as PR #856 (squash → commit `643327a1`). Greptile 5/5, all CI green. Final commits on branch (squashed):

**Why a server-side `/api/auth/sync` route:** the client-side `api.users.syncUser` mutation in `convex/users.ts:308` runs as the *user* identity and intentionally refuses to set `role` to anything more privileged than what the caller already is. Without the trusted path, first-time admin sign-in leaves `users.role` empty and `convex/admin.ts:isAdminUser` gates `/admin`. Apps/platform avoids this with a Clerk webhook → Inngest → `internal.users.setUserRoleTrusted` chain (`apps/platform/app/api/webhooks/clerk/route.ts`); apps/marketing has no webhook, so the `/api/auth/sync` route is the equivalent. It uses `CONVEX_HTTP_KEY` bearer against the existing `convex/http.ts` httpAction `/users/set-role`, which calls `internal.users.setUserRoleTrusted`.

**Files in PR 3 (so far):**
- `apps/marketing/app/admin/page.tsx` — replaced `getAdminStats()` Supabase call with `useQuery(api.admin.getStats)`. Quick actions use `<Button asChild><Link>` (no nested interactive controls). No `requireAdmin()` call (layout handles).
- `apps/marketing/app/admin/admin-stats.tsx` (new) — 4 stats cards via `useQuery(api.admin.getStats)`.
- `apps/marketing/app/admin/admin-instructors-section.tsx` (new) — preview via `useQuery(api.admin.getInstructorsForAdmin, { pageSize: 5 })`. Server-side `deletedAt + isActive` filter is the source of truth; client-side `i.isActive` filter is a defensive double-check.
- `apps/marketing/tsconfig.json` — added `"@/convex/_generated/*": ["../../convex/_generated/*"]` so `api.users.*` etc. resolve.
- `apps/marketing/lib/providers/query-provider.tsx` — `AuthDrivenInvalidator` now calls `fetch('/api/auth/sync')` instead of `useMutation(api.users.syncUser)` directly. Tracks `(userId, role)` tuple so role downgrades / account switches re-sync. Added `convexAuthLoading` + `clerkLoaded` guards and `inFlightRef` to avoid double-fire; error path leaves tuple unset so next run retries.
- `apps/marketing/app/api/auth/sync/route.ts` (new) — GET, no body. Reads Clerk `auth()`, calls `resolveUserRole()` (claims → Backend API fallback), POSTs to Convex `/users/set-role`. Returns `{success, user, clerkIsAdmin}` on hit, `{noop}` when Clerk has no role, `{error}` on Convex failure. Bearer value (`CONVEX_HTTP_KEY`) never logged.
- `apps/marketing/lib/convex-server-call.ts` (new) — verbatim mirror of `apps/platform/lib/convex-server-call.ts`. `CONVEX_HTTP_KEY` bearer, `.convex.cloud → .convex.site` rewrite, no retry.
- `convex/admin.ts:getInstructorsForAdmin` — server-side filter `i.deletedAt == null && i.isActive !== false`. Comment notes Convex indexes do not support "not-equal" filtering; collect+filter is fine for the admin list size; if it grows, add a `by_deletedAt` partial index or denormalized `isListed`.

**Risks:**
- The trusted endpoint at `convex/http.ts` `httpServerVerifiedSetUserRole` already exists and was hardened in PRs #669–#675 (shared-secret path removed). Apps/marketing just consumes it; no new auth surface.
- Apps/platform's `requireRole` is unaffected by the `convex/admin.ts:getInstructorsForAdmin` filter change — the platform admin listing already returned non-deleted rows because `apps/platform/app/admin/instructors/page.tsx` uses `useSuspenseQuery(api.admin.getAllInstructors)` which has its own (unchanged) filter path. If a regression appears, narrow the filter to a new arg rather than removing it.
- The `AuthDrivenInvalidator` only calls `/api/auth/sync` when the user is signed in AND Clerk has loaded AND Convex auth has resolved. Edge case: if Clerk signs the user out mid-session, the next effect run triggers a re-sync only if `sessionClaims` changes. A complete role deactivation in Clerk Dashboard does not auto-propagate until the user's JWT expires; this is acceptable for marketing's scale (≤5 admins).

---

## 4b. PR 4 spec (admin instructors — Convex port)

**Status:** ✅ Merged as PR #857 (squash → commit `c4ea241c`). Greptile 5/5, all CI green. Tracking issue HUC-35.

**Why this PR was the priority:** The marketing `/admin/instructors` page was throwing `500 operator does not exist: text = uuid` due to a Drizzle/Postgres column-type mismatch (see §1). The fix required migrating the entire page to read from Convex.

**Convex queries / mutations added to `convex/admin.ts`** (all admin-gated via `requireAdmin`):

| Function | Args | Behavior |
| --- | --- | --- |
| `getInstructorsWithStatsForAdmin` | `{search?, paginationOpts}` | Cursor-paginated via `paginate()` over the `by_deletedAt` partial index. Per-page seat counts via `by_instructorId_status` index. |
| `getInstructorWithStudents` | `{instructorId}` | Per-instructor `by_instructorId` reads for seats + `sessionPacks`; filters orphaned packs (no seat reservation); per-pack completed-session aggregation via `by_sessionPackId` index. |
| `getFullAdminCsvData` | `{nonce?}` | Full admin report rows; filters `sessionPacks` to those with a real seat reservation (orphaned packs excluded). `nonce` arg forces fresh query key on repeat exports. |
| `incrementRemainingSessions` | `{sessionPackId}` | Atomic; flips `depleted → active` when new balance > 0. |
| `decrementRemainingSessions` | `{sessionPackId}` | Atomic; flips `active`/`depleted → depleted`. Preserves `refunded`/`expired` terminal statuses. |

**Hook (`apps/marketing/lib/queries/convex/use-instructors.ts`):**

- `useInstructorsWithStatsForAdmin({search, pageSize})` — uses `useQueries` so every loaded cursor stays reactively subscribed. Tracks a `cursorChain` so `loadMore(n)` appends new subscriptions without re-issuing prior fetches.
- `useInstructorWithStudents(id)` — single-instructor detail with `enabled` gate.
- `useFullAdminCsvData(enabled)` — lazy CSV query with `bumpNonce()` for cache-busting.
- `useIncrementRemainingSessions` / `useDecrementRemainingSessions` — Convex mutation hooks.

**Page rewrite:**

- `apps/marketing/app/admin/instructors/page.tsx` — thin `"use client"` wrapper around `<InstructorsTable />`.
- `apps/marketing/components/admin/instructors-table.tsx` — fully Convex-driven. URL-backed search via `useSearchParams` + `useEffect` sync. `ExportCsvButton` is lazy and click-triggered. Explicit error rows (no more "No instructors found" masking errors).

**API routes deleted** (no longer needed):

- `apps/marketing/app/api/admin/instructors/route.ts`
- `apps/marketing/app/api/admin/instructors/[id]/mentees/route.ts`
- `apps/marketing/app/api/admin/instructors/csv/route.ts`
- `apps/marketing/app/api/admin/session-counts/route.ts`

**Greptile review history:** 5 rounds; final confidence 5/5. Key fixes across rounds:
1. URL state init from `searchParams` + `useEffect` resync for back/forward navigation.
2. Cursor-based pagination via `paginate()` + `paginationOptsValidator` (replaced numbered `.take(pageSize)`).
3. Seatless-pack filter in detail view AND in CSV export (orphaned packs were mislabelled).
4. Expanded-row error state + listing-query error state (was rendering "No instructors found").
5. Lazy `ExportCsvButton` with `enabled` gate + `bumpNonce` cache-bust (TanStack Query has `staleTime: Infinity`).
6. `decrementRemainingSessions` preserves `refunded`/`expired` terminal statuses (was overwriting them with `depleted`).
7. Per-cursor reactive subscriptions via `useQueries` so all loaded pages stay live.

**Known limitations (non-blocking):**

- Search filter is applied client-side after a 500-row window is fetched. To cover all matches without paginating manually, the proper fix is a text-friendly index in `convex/schema.ts` (e.g., a `by_emailPrefix` index using `search`-compatible Convex `searchIndex`). Tracked as future work; current solution is pragmatic for marketing's ≤50 instructor scale.
- The old `?page=N` URL parameter is ignored under cursor pagination. Search is the only URL state.

**Risks:**
- Each loaded cursor becomes its own Convex subscription; very deep pagination (10+ pages) could exceed the user's concurrent query limit. For marketing's admin scale (≤5 admins, ≤50 instructors) this is not a concern.
- The seatless-pack filter in CSV export means a pack without an active seat reservation is invisible in the admin report. This matches the intent (a pack with no one using it is dead inventory) but admins should be aware.

---

## 5. Follow-ups (after PRs 2–7 land)

### 5.1 Drizzle schema cleanup (separate PR, optional)

If desired, fix the Drizzle mismatches noted in §1 so any future Supabase query that JOINs these tables works correctly:

- `packages/db/src/schema/sessionPacks.ts` — `id` from `text()` → `uuid()`.
- `packages/db/src/schema/seatReservations.ts` — `id` and `sessionPackId` from `text()` → `uuid()`.
- `packages/db/src/schema/instructorIntegrations.ts` — `id` from `text()` → `uuid()`.

Verify by re-running the failed query from §1 once it has been re-pointed at the patched schema (or via a smoke test). This is unrelated to the Convex migration but worth fixing for any remaining Supabase reads.

### 5.2 Linear verification issue

Per AGENTS.md "Schema-changing PR convention": if PR 2+ touches `convex/schema.ts`, create a verification issue titled `Verify "<change>" on prod` in the `Post-Merge Verification` project with labels `schema-change`, `verification`, `prod`. The Convex migration PRs likely will NOT touch the schema (only consumers of `api.*`); if so, no issue is required.

PR 4 added 5 new functions to `convex/admin.ts` (no schema changes). Tracking issue: **HUC-35** (state `In Progress`).

## 4c. PR 5 spec (admin orders — Convex port, refund action)

Marketing's `/admin/orders` page was the **only** broken admin view going into this arc. The 349-line page called `fetch('/api/admin/orders')` and `fetch('/api/admin/refunds')`, neither of which exists in `apps/marketing/app/api/admin/` — so the table returned `Failed to fetch orders` and the refund modal never opened in prod.

**Refactor**: replace the broken fetch calls with a cursor-paginated Convex query + a public action that gates on admin, calls Stripe/PayPal, updates the payment+order, and emails the student.

### New Convex functions

| File | Symbol | Kind | Notes |
| --- | --- | --- | --- |
| `convex/admin.ts` | `getOrdersForAdminCursor` | query | Cursor-paginated orders list (`paginationOpts`, optional `search`/`statusFilter`). Admin-gated. Server-side `numItems` clamped to `[1, 500]`. Uses `by_status` index when `statusFilter` is set, otherwise the `_creationTime` primary index with `.order("desc")`. Joins payments via `by_orderId` per page. |
| `convex/admin.ts` | `isAdmin` | internalQuery | Admin check for actions (which can't read `ctx.db` directly). |
| `convex/orders.ts` | `getOrderByIdInternal` | internalQuery | Lookup used by the refund action to find the order for the email. |
| `convex/payments.ts` | `getPaymentByIdInternal` | internalQuery | Lookup used by the refund action. |
| `convex/payments.ts` | `adminProcessRefundInternal` | internalMutation | Admin-gated DB update (status flips + audit log). Defensive bound check rejects over-refunds (`prior + delta > original`). The existing public `adminProcessRefund` is kept because platform + web admin API routes still call it. |
| `convex/adminRefunds.ts` *(new)* | `processRefundForAdmin` | action (`"use node"`) | Public action: admin-gate → load payment → compute refund amount → record `admin_refund_attempted` audit row → call Stripe/PayPal with idempotency key (`paymentId:refundType:amount:priorRefunded:adminSubject:clientNonce`) → call internal mutation (writes `admin_refund_completed` audit row) → best-effort send refund email via Resend. HTML-escaped reason + instructor name in email. |

**Reuses existing functions** (no changes needed): `convex/orders.ts:getOrdersForAdmin` (offset-based, still used by `apps/platform` + `apps/web` admin API routes), `convex/payments.ts:adminProcessRefund` (public version, same callers), `convex/users.ts:getUserByUserId` (admin-gated public query, used to look up the recipient's email).

### Marketing hook + component

| File | Purpose |
| --- | --- |
| `apps/marketing/lib/queries/convex/use-orders.ts` *(new)* | `useOrdersForAdmin({search?, statusFilter?, pageSize?})` — per-cursor `useQueries` pattern (same as `use-instructors.ts`). `useProcessRefundForAdmin()` — `useConvexAction` wrapper. Helpers: `formatMoney`, `remainingRefundable`. |
| `apps/marketing/lib/queries/convex/index.ts` | Add `export * from "./use-orders"`. |
| `apps/marketing/components/admin/orders-table.tsx` *(new)* | `<OrdersTable />` extracted component. Search input + status filter + refund modal. Refund modal calls `useProcessRefundForAdmin` directly. |
| `apps/marketing/app/admin/orders/page.tsx` | Rewrite as a 9-line wrapper around `<OrdersTable />`. |

### Schema impact

**None.** PR 5 only adds functions and a component. The existing `orders` table has no `by_deletedAt` index, so PR 5 mirrors the existing offset query and does NOT filter on `deletedAt` (soft-deleted orders would be visible — same as apps/platform today). Add the index in a future PR if soft-deletes become noisy.

### Why a new file (`convex/adminRefunds.ts`)?

`convex/admin.ts` only imports `query` and `mutation`. Adding `action` + `internalAction` would mix Node-only Stripe SDK code with the existing query/mutation handlers. Per Convex guidelines, a single file should not mix `"use node"` with query/mutation exports. The split keeps the action's transitive dependencies (Stripe + PayPal fetch helpers + Resend fetch helper) isolated.

### Why a public action (not internal)?

The action is invoked from the marketing client (a "use client" component via `useConvexAction`). It cannot be internal. It admin-gates itself via `ctx.runQuery(internal.admin.isAdmin, {subject})` because actions can't directly read `ctx.db`.

### Manual prod deploy required (per §5.3)

6 new functions need a manual `CONVEX_DEPLOYMENT=prod:fine-bulldog-260 npx convex@1.45.0 deploy` after merge. Tracking issue: **HUC-36** (state `Backlog` → `In Progress` after merge).

### Known limitations (mirrors existing platform behaviour)

The following concerns surfaced during Greptile review. PR 5 does NOT regress any of these — the new action calls the same `adminProcessRefund` mutation that the platform admin route already calls, so the limitations are pre-existing platform-level behaviours.

1. **Partial refund → full session-pack entitlement reversal**. The current `adminProcessRefund` mutation does NOT touch `sessionPacks` or instructor inventory. If a partial refund is followed by a separate logic path that revokes the full pack (e.g., the platform's manual `payouts.ts` reconciliation), the student's remaining sessions vanish. This is consistent with the existing platform behaviour. A future PR could introduce a `payment_refunds` table that records each partial refund and a proportional session reduction.
2. **Provider refund → DB ordering**. The action calls Stripe/PayPal BEFORE the local mutation. If the mutation fails (network drop, Convex outage) after the provider accepted the refund, the user can retry from the same modal — the idempotency key binds `(paymentId, refundType, amount, priorRefunded, adminSubject, clientNonce)`, so the provider dedupes and the local DB update commits the recorded amount. A different admin opening the modal gets a fresh `clientNonce` and proceeds as a separate operation. The audit log records `admin_refund_attempted` BEFORE the provider call and `admin_refund_completed` AFTER the DB mutation, so an operator has a recoverable trail even if both writes fail.
3. **Concurrent same-amount refunds from different admins**. Two admins clicking "refund $10" at the same time on the same payment each get distinct idempotency keys (different `adminSubject` and `clientNonce`) so both Stripe refunds succeed and both DB updates commit. Total refunded = $20, which is the intended behaviour for legitimate concurrent partial refunds.

### 5.3 Convex prod deploy — manual step (operational note)

CI's `convex-codegen` job only generates `_generated/` artifacts; it does NOT push new functions to prod. Each PR that adds/updates `convex/*.ts` functions requires a manual prod deploy:

```bash
CONVEX_DEPLOYMENT=prod:fine-bulldog-260 npx convex@1.45.0 deploy
```

(or the equivalent for a different prod deployment). Use the dev deployment (`acoustic-kiwi-522`) for development; CI's codegen job uses `CONVEX_DEPLOYMENT=production`.

**PR 4 deploy (2026-09-20 13:50 UTC):** +24 functions (619 → 643). Verified `admin.js:getInstructorsWithStatsForAdmin`, `getInstructorWithStudents`, `getFullAdminCsvData`, `incrementRemainingSessions` reachable in prod function spec.

**PR 5 deploy (2026-09-20 16:35 UTC):** +6 functions (643 → 649). Verified `admin.js:getOrdersForAdminCursor`, `admin.js:isAdmin`, `orders.js:getOrderByIdInternal`, `payments.js:getPaymentByIdInternal`, `payments.js:adminProcessRefundInternal`, `adminRefunds.js:processRefundForAdmin` reachable in prod function spec.

Future PRs in this arc (5–7) must follow the same pattern. Greptile/CI will pass on the PR even if the prod deploy was missed — verification only happens via the production function spec, not the CI build.

---

## 4e. PR 6a spec (port marketing addToWaitlist to Convex)

**Goal:** replace the Supabase-backed student-facing waitlist write path (`apps/marketing/components/instructors/offer-button.tsx:32` → `lib/supabase-inventory.ts:169` → `app/api/waitlist/route.ts` → Supabase `marketing_waitlist`) with a **rate-limited, dedup-by-type, Convex action** invoked from the marketing app. Establishes Convex as the single source of truth for new signups so PR 6's admin port can ship at ≥4/5 Greptile.

### Status: paused (2026-09-20) — scope expansion required

First implementation landed one commit (`ae4e1001`) on `feat/marketing-port-addtowaitlist`. Greptile held at **0/5** with four P1 comments that expose structural gaps the original spec did not anticipate. Branch reset to `main`, force-pushed, deleted from origin. Spec below expands to address all four.

### Greptile 0/5 — what the original spec missed

| P | Issue | Why the original spec was wrong |
| --- | --- | --- |
| 1 | `offer-button.tsx:39-41` — joining 1-on-1 then group for the same instructor overwrites the first waitlist entry | `convex/waitlist.ts:addToWaitlist` dedupes by `(email, instructorSlug)` and **patches `mentorshipType`**. The Supabase schema allowed separate rows per `(email, instructorSlug, mentorshipType)` triple. Same defect exists in apps/web today; PR 6a amplifies it. |
| 2 | `use-waitlist.ts:53-54` — static generation crash | `useConvexMutation` evaluates during render. Marketing's `skipClerk` build-time branch renders without a Convex provider. Instructor slug pages are statically generated, so prerendering throws. PR 6a's original spec called for `useConvexMutation`, which assumes the provider is always present. |
| 3 | `use-waitlist.ts:54` — new signups miss notification emails | Documented as a known limitation but Greptile escalates to P1: visitors get "You're on the waitlist!" then never hear back when capacity opens. PR 6b is required before PR 6a can ship. |
| 4 | `use-waitlist.ts:54` — rate-limit + Zod validation bypass | `/api/waitlist` did server-side Zod validation and proxied through Supabase, which applies per-IP rate limits. A direct public Convex mutation has neither. |

### Why a Convex action (not a mutation)

The original spec reused the existing `api.waitlist.addToWaitlist` mutation directly from the client. To clear P1 #2 and P1 #4, PR 6a must:

1. Call a **Convex action** (`api.waitlist.addToWaitlistAction`) instead of a mutation. The action runs server-side, so it always has a Convex context, even when the marketing app's provider tree is absent at build time. The client invokes it through the same `useAddToWaitlist` hook shape, but the hook now wraps `useConvexAction` and the action does the validation + rate-limit + dedup check before calling the internal mutation.
2. Keep the existing `addToWaitlist` mutation as an **internal** function (`api.waitlist.internal.addToWaitlist`) callable only from the action. Public callers go through the action.
3. The action implements per-IP rate limiting via `@convex-dev/rate-limiter` (already available in `convex/_components/` per PR 5 — see `convex/components.config.ts`). 5 writes per IP per hour is the initial limit (matches what Supabase's proxy effectively enforced for unauthenticated traffic).
4. The action runs the existing dedup logic against `(email, instructorSlug, mentorshipType)` triple (fix P1 #1). Add a new compound index `by_email_instructorSlug_mentorshipType` to `marketingWaitlist` in `convex/schema.ts`. This is a **schema change** — requires manual Convex prod deploy after merge (matches the §4f convention from the instructorProfiles arc).

### Reused Convex functions

| Function | Source | Used for |
| --- | --- | --- |
| `waitlist.addToWaitlist` *(existing — to become `internal.addToWaitlist`)* | `convex/waitlist.ts:102` | Server-side insert from the new action. |
| `waitlist.getWaitlistForInstructor` *(unchanged)* | `convex/waitlist.ts:14` | Admin modal reads (PR 6 will use this). |
| `waitlist.removeMultipleFromWaitlist` *(unchanged)* | `convex/waitlist.ts:144` | Admin modal deletes (PR 6 will use this). |
| `waitlist.markNotifiedByInstructor` *(unchanged)* | `convex/waitlist.ts:200` | Admin modal notifies (PR 6 will use this). |

### New Convex code (one action + one schema index)

| Change | Source | Notes |
| --- | --- | --- |
| New action `api.waitlist.addToWaitlistAction(args: { email, instructorSlug, mentorshipType })` | `convex/waitlist.ts` (new export) | Validates args with a `v.*` schema, rate-limits by IP via `@convex-dev/rate-limiter`, then calls `internal.waitlist.addToWaitlist` with `(email, instructorSlug, mentorshipType)` triple dedup. Returns `{ success, message, existingId? }`. |
| New index `by_email_instructorSlug_mentorshipType` | `convex/schema.ts` (`marketingWaitlist` table) | Compound index on `(email, instructorSlug, mentorshipType)`. Enables the triple-key dedup that fixes P1 #1. **Schema change** → manual Convex prod deploy. |
| Renamed export `addToWaitlist` → `internal.addToWaitlist` | `convex/waitlist.ts` | Public mutation becomes internal. Caller surface shrinks. apps/platform already calls through the mutation — apps/platform keeps working because the action is the only public entry point and apps/platform uses its own `/api/waitlist` route which calls the public mutation (a separate small change in apps/platform is required, tracked in PR 6c). |

### apps/platform parallel change (PR 6c, follow-up)

apps/platform currently calls `api.waitlist.addToWaitlist` directly from `apps/platform/app/api/waitlist/route.ts:30`. After PR 6a renames the mutation to `internal.addToWaitlist`, apps/platform's call breaks. Two options:
- (A) Update apps/platform's `/api/waitlist` route to call the new `api.waitlist.addToWaitlistAction` instead.
- (B) Have apps/platform keep calling a public `api.waitlist.addToWaitlist` **public** mutation that the action delegates to.

PR 6a ships with option (B) — public mutation stays, just renamed `publicAddToWaitlist`, and the action calls into it after rate-limiting + triple dedup. apps/platform does not need to change in PR 6a; PR 6c later moves apps/platform to the action for symmetry.

### New / changed marketing files

| File | Change |
| --- | --- |
| `apps/marketing/lib/queries/convex/use-waitlist.ts` *(new)* | Exports `useAddToWaitlist()` wrapping `useConvexAction(api.waitlist.addToWaitlistAction)` with TanStack `useMutation`. Invalidate `["waitlist"]` on success. |
| `apps/marketing/lib/queries/convex/index.ts` | Add `export * from "./use-waitlist"`. |
| `apps/marketing/components/instructors/offer-button.tsx` *(modify)* | Replace `import { addToWaitlist } from "@/lib/supabase-inventory"` with `import { useAddToWaitlist } from "@/lib/queries/convex"`. The hook is called inside the component body (not at module top level) and the mutation result is awaited via `mutateAsync` from React Query so error toasts surface. Translate `kind === "oneOnOne"` → Convex literal `"oneOnOne"`. Map the return shape: `existingId` present → "Already on waitlist" toast; `success: true` and no `existingId` → "You've been added!" toast + `setJoined(true)`; rate-limit error → show server-supplied message. |
| `apps/marketing/lib/supabase-inventory.ts` | Remove the `addToWaitlist` export only. Keep `getInstructorInventory`, `getWaitlistStatus`, `removeFromWaitlist`, `logInventoryChange`. |
| `apps/marketing/app/api/waitlist/route.ts` | **Leave as-is** for now (still reachable from any third-party). Cleanup PR after PR 6 + 6b + 7 deletes it. |

### Type translation table (unchanged from original spec)

| Marketing component prop | Supabase value (legacy) | Convex literal |
| --- | --- | --- |
| `kind === "oneOnOne"` | `"one-on-one"` | `"oneOnOne"` |
| `kind === "group"` | `"group"` | `"group"` |

### Schema impact

**Yes — schema change.** Adds `by_email_instructorSlug_mentorshipType` compound index to `marketingWaitlist` in `convex/schema.ts`. Requires **manual Convex prod deploy** after merge: `CONVEX_DEPLOYMENT=prod:fine-bulldog-260 npx convex@1.45.0 deploy`. Linear issue HUC-38 already tagged with the `schema-change` label per AGENTS.md convention.

### Compatibility with existing callers

| Caller | After PR 6a |
| --- | --- |
| `apps/marketing/components/instructors/offer-button.tsx` | Uses Convex action via `useAddToWaitlist` hook. |
| `apps/platform/app/api/waitlist/route.ts` | Unchanged. Still calls the now-renamed public mutation `api.waitlist.publicAddToWaitlist` (which is the action's delegate). |
| `apps/web/app/waitlist/[slug]/page.tsx` | Unchanged. Already uses apps/web's own Convex hook (`apps/web/lib/queries/convex/use-waitlist.ts`). |
| `apps/marketing/app/api/waitlist/route.ts` | Still reachable, still writes to Supabase. Unused by the marketing app after PR 6a. Cleanup PR after PR 6 + 6b + 7. |
| `apps/marketing/inngest/functions/waitlist-notifications.ts` | Unchanged. Still reads Supabase. **Will miss new Convex signups** until PR 6b rewrites the worker. PR 6a does **not** unblock availability emails — that's PR 6b's job. |
| `apps/marketing/inngest/functions/inventory-available.ts` | Unchanged. Same caveat. |

### Known limitations

1. **Inngest worker still reads Supabase (PR 6b dependency).** PR 6a does not fix notification emails — that's PR 6b's job. Until PR 6b ships, visitors joining via Convex will see "You're on the waitlist!" but no email when capacity opens. **PR 6 cannot ship until PR 6b also lands.**
2. **`/api/waitlist` route still hits Supabase.** Any third-party POSTing to it continues to write to Supabase. Cleanup PR after PR 6 + 6b + 7 deletes it.
3. **Existing Supabase waitlist rows remain in Supabase.** No backfill. PR 6's admin UI will not show pre-PR-6a entries. Acceptable for the inventory admin use case.
4. **apps/platform still uses the public mutation, not the action.** PR 6c moves apps/platform onto the action for symmetry. Until then, apps/platform bypasses the rate limiter. Document in HUC-38.

### Verification (Linear)

Tracking issue: **HUC-38** (state `Backlog` → `In Progress` after merge). Smoke tests:
1. `mentorships.huckleberry.art/instructors/<slug>` opens without a build error in the marketing CI build log (`pnpm build`). The original P1 #2 surfaced as a static prerender crash — confirming it builds clean is the first smoke test.
2. Set `oneOnOneInventory = 0` for any instructor from the admin `/admin/inventory` page (still on Supabase pre-PR-6). Click "Join Waitlist" on the 1-on-1 offer button.
3. Submit a valid email → success toast within 2 seconds. The mutation is visible in the Convex WebSocket traffic; no POST to `/api/waitlist` in the Network tab.
4. Convex dashboard → `marketingWaitlist` table has the new row with `email`, `instructorSlug`, `mentorshipType="oneOnOne"`, `createdAt` populated, `notifiedAt=null`.
5. Duplicate email submission for the same instructor + same type → toast says "You're already on the waitlist!" (action returns `{ success: false, message: "Already on waitlist for this type", existingId: ... }`).
6. Same email + different type (group) → second row inserted (NOT an overwrite — fixes P1 #1). Both rows exist for the same `(email, instructorSlug)` with different `mentorshipType`.
7. Rate-limit smoke: submit 6 distinct emails from the same IP within an hour → 6th submission returns the action's rate-limit error, surfaced in the toast as a server-supplied message.
8. apps/web parallel flow at `dev.mentorships.huckleberry.art/waitlist/[slug]` still works (independent Convex path).
9. `CONVEX_DEPLOYMENT=prod:fine-bulldog-260 npx convex@1.45.0 deploy` succeeds — schema change verified deployed to prod.

### What unlocks after this PR + PR 6b

- **PR 6 (admin inventory port)** — the source-of-truth divergence goes away; Greptile should approve at ≥4/5.
- **PR 6b (Inngest worker rewrite)** — separate PR. Read from `marketingWaitlist` (Convex) instead of `marketing_waitlist` (Supabase). Becomes a Convex action invoked from a Convex cron or webhook.
- **PR 6c (apps/platform parity)** — moves apps/platform onto the action for symmetry.

---

## 4d. PR 6 spec (admin inventory — Convex port)

**Goal:** replace the Supabase-backed `apps/marketing/app/admin/inventory/page.tsx` and `apps/marketing/components/admin/inventory-table.tsx` with Convex reads + mutations, mirroring the UX of `apps/web/app/admin/inventory/page.tsx`. The page is admin-only (the parent `app/admin/layout.tsx` already gates access via `isAdminUser()`), so the wrapper page can drop the redundant `requireAdmin()` server check.

### Status: paused (2026-09-20)

First implementation attempt landed 7 commits on `feat/marketing-admin-inventory` but Greptile reviews held confidence at **1/5** due to a structural issue: live public waitlist signups continue to flow through the Supabase `marketing_waitlist` table via `apps/marketing/components/instructors/offer-button.tsx:32` (`addToWaitlist`), while the new admin UI reads and writes the Convex `marketingWaitlist` table. The two sources can diverge, so the admin cannot manage current demand from the new page. The branch was reset to `main` and the implementation reverted; the spec below is preserved for the next attempt once the structural prerequisite lands.

### Prerequisite (separate PRs before resuming PR 6)

Single source of truth for the waitlist. All three must be done before PR 6 can ship at ≥4/5 Greptile:

1. **Port `addToWaitlist` to Convex — PR 6a (spec in §4e, tracking HUC-38).** Replace the Supabase insert in `apps/marketing/components/instructors/offer-button.tsx:32` with a Convex **action** (not a direct mutation) so rate limiting + static-gen work correctly. The first implementation attempt (`ae4e1001`) reached 0/5 Greptile — see §4e "Why a Convex action (not a mutation)" for the four P1s and the structural fix design. Touches `convex/schema.ts` (adds `by_email_instructorSlug_mentorshipType` index) — manual Convex prod deploy required.
2. **Rewrite `apps/marketing/inngest/functions/waitlist-notifications.ts` as a Convex action — PR 6b (no spec yet, no tracking).** Read from `marketingWaitlist` (the Convex table) instead of `marketing_waitlist` (the Supabase table). Move the email send to a Convex action that calls `inngest.send({ name: 'waitlist/notify-users', data: ... })` internally, so the page can `await ctx.runAction(api.waitlist.notifyInstructor, {...})` instead of `fetch('/api/admin/waitlist-notify', ...)`.
3. **Move apps/platform onto the new action — PR 6c (no spec yet, no tracking).** apps/platform currently calls `api.waitlist.publicAddToWaitlist` directly from `apps/platform/app/api/waitlist/route.ts:30`. PR 6a renames the public mutation to be an action delegate, but apps/platform stays on the delegate until PR 6c for symmetry (so apps/platform also benefits from the rate limiter).

After all three land, resume PR 6 against the same spec.

### Reused Convex functions (no new code in `convex/`)

PR 6 does **not** add any Convex functions. Every read/write is satisfied by existing, already-deployed functions from the instructor and waitlist modules:

| Function | Source | Used for |
| --- | --- | --- |
| `instructors.getInstructorsForAdmin` | `convex/instructors.ts:1232` | List page. Returns `_id`, `name`, `slug`, `email`, `oneOnOneInventory`, `groupInventory`, `maxActiveStudents`, `activeStudentCount`. |
| `instructors.updateInstructor` | `convex/instructors.ts:1556` | Per-card +/- inventory buttons. Callers pass `{ id, oneOnOneInventory }` or `{ id, groupInventory }`; the mutation's admin branch atomically writes both via `internalAtomicFullUpdateInstructor`. |
| `waitlist.getWaitlistForInstructor` | `convex/waitlist.ts:14` | Modal entries. Optional `mentorshipType` filter (`"oneOnOne"` \| `"group"`). |
| `waitlist.markNotifiedByInstructor` | `convex/waitlist.ts:200` | "Mark All Notified" + per-card "Mark as Notified" hover actions. |
| `waitlist.removeMultipleFromWaitlist` | `convex/waitlist.ts:144` | "Delete Selected" in the modal. |

All five are admin-gated server-side (`requireAdmin` / `isAdminUser`); the marketing hooks add no client-side gating beyond `enabled: !!instructorSlug`.

### New marketing files

| File | Purpose |
| --- | --- |
| `apps/marketing/lib/queries/convex/use-inventory.ts` *(new)* | `useInventoryInstructors()` wraps `api.instructors.getInstructorsForAdmin({ limit: 200 })` (well under `DEFAULT_INSTRUCTOR_LIST_LIMIT=100` + headroom for future growth). `useUpdateInventory()` wraps `api.instructors.updateInstructor` with a React Query optimistic `onMutate` against the convexQuery cache key (`["convexQuery", api.instructors.getInstructorsForAdmin, { limit: 200 }]`) so rapid consecutive +/- clicks compose correctly. `useWaitlistForInstructor(slug, type?)`, `useMarkNotifiedByInstructor()`, `useRemoveMultipleFromWaitlist()` mirror `apps/web/lib/queries/convex/use-waitlist.ts`. |
| `apps/marketing/lib/queries/convex/index.ts` | Add `export * from "./use-inventory"`. |
| `apps/marketing/components/admin/inventory-table.tsx` *(rewrite, 989 → ~450 lines)* | Client component. Card grid: one card per instructor, +/- buttons per inventory type, "View Waitlist" + "Mark as Notified" hover menu (button renamed from "Notify Waitlist" since the new flow records state only), modal with checkbox selection. Drops the TanStack `useForm` (replaced by direct `updateInstructor` mutations with optimistic local state) and the `lib/supabase-inventory.ts` calls. |
| `apps/marketing/app/admin/inventory/page.tsx` *(rewrite, 60 → ~30 lines)* | Client wrapper. Imports the static `instructors` config for `has_pricing_*` flags, renders `<InventoryTable />`. Layout-level `isAdminUser()` already gates access. |

### Static config role (intentionally preserved)

`apps/marketing/lib/instructors.ts` keeps its role as the source of marketing copy (slug → name → offer labels → `has_pricing_*`). It is **not** the source of inventory data any more — that's Convex. The page iterates over the Convex list (the source of truth) and looks up static config by slug to render offer pills and the "1-on-1" / "Group" toggles.

### Schema impact

**None.** PR 6 reuses existing queries/mutations. No `convex/schema.ts` changes, so no manual prod deploy (the `syncEnvVars` step from PR 5 is unnecessary). Greptile verification is sufficient.

### Compatibility with the existing Supabase API routes

`apps/marketing/app/api/admin/{waitlist,waitlist-notify,waitlist-delete,waitlist-csv}/route.ts` and `apps/marketing/lib/supabase-inventory.ts` are **not** deleted in PR 6. They are still used by:

- `apps/marketing/components/instructors/offer-button.tsx` (student-facing waitlist join — `addToWaitlist`; will be ported in the prerequisite PR)
- `apps/marketing/app/api/instructor/inventory/route.ts` (instructor-facing inventory view — `getInstructorInventory`)
- `apps/marketing/app/api/webhooks/kajabi/route.ts` (Kajabi webhook — `logInventoryChange`)
- `apps/marketing/lib/supabase-csv-sync.ts` and other automation not surfaced in the admin UI

A follow-up cleanup PR can migrate these after the prerequisite + PR 7 land; for now PR 6 only changes the admin page.

### Known limitations

1. **200-instructor hard cap.** `useInventoryInstructors` requests `limit: 200`. This is fine for the current ~28-instructor corpus but means a future `>200` instructor set would silently truncate. If/when the corpus grows, mirror PR 5's cursor-paginated `getInstructorsWithStatsForAdmin` pattern.
2. **"Mark as Notified" only flips `notifiedAt` in Convex — no emails are sent from this surface.** Even after the prerequisite PRs land (Convex `addToWaitlist` + Convex action for the Inngest worker), the per-card and modal "Mark as Notified" buttons will only update state. Restoring transactional waitlist emails from this UI surface is a separate follow-up that the prerequisite PRs set up but do not complete (the worker is now a Convex action, but the admin page still calls it through `fetch('/api/admin/waitlist-notify', ...)` until PR 6 wires up the action directly).
3. **CSV export is not yet wired.** `apps/web/app/admin/inventory/page.tsx` has no CSV button either, so PR 6 matches the closest reference impl. The old marketing route (`/api/admin/waitlist-csv`) remains available but is no longer linked from the UI.
4. **`updateInstructor` race window.** If two admins +/- the same instructor concurrently, the last write wins (Convex writes the full instructor doc). This matches the existing platform behaviour; a future "session-pinned" update could be added if reconciliation becomes a problem. The optimistic `onMutate` in `useUpdateInventory` reduces but does not eliminate this — it composes correctly against the cache but still races against a concurrent admin on another machine.

### Verification (Linear)

Tracking issue: **HUC-37** (state `Backlog` → `In Progress` after prerequisite PR merges + PR 6 merge). Smoke tests:
1. `mentorships.huckleberry.art/admin/inventory` returns a 200 (was 500 + Supabase 502 before PR 1–5, broken since Supabase `text`/`uuid` join).
2. The page lists every non-deleted instructor from Convex (verified against `instructor.listInstructors`).
3. +/- oneOnOne and group buttons persist via `api.instructors.updateInstructor`. Reload page → values unchanged.
4. View Waitlist modal opens for a slug that has waitlist entries; shows `email`, `createdAt`, `notifiedAt` per entry; checkboxes + "Delete Selected" removes selected rows via `removeMultipleFromWaitlist`.
5. "Mark All Notified" sets `notifiedAt = Date.now()` on every unnotified entry for the active tab.
6. Static config (`apps/marketing/lib/instructors.ts`) still drives the offer pill labels and the `has_pricing_*` gating — admin sees the same UX shape as before the migration.
7. **Live waitlist parity check.** Create a new waitlist entry via the public student-facing flow (click "Join Waitlist" on a 1-on-1 instructor). It appears in the modal within 2 seconds without a manual refresh — proves `addToWaitlist` writes to Convex (prerequisite PR).

---

## 6. References

- AGENTS.md → "Naming Conventions: NEVER use mentor/mentee" — `instructor`/`student` everywhere.
- AGENTS.md → "Pull Request Merge Policy" — Greptile + CodeRabbit (skip if `<10` stars); squash merge.
- AGENTS.md → "Schema-changing PR convention" — Linear verification issue.
- AGENTS.md → "Clerk Changes Policy (Do Not Touch)" — PR 2 *did* change Clerk-related code (introduced `clerkClient()` calls and shifted admin auth from email allowlist to Clerk claims). The user explicitly approved this exception at the start of the arc, with the understanding that the marketing admin role model should mirror apps/platform. PRs 3–7 should not introduce additional Clerk changes.
- AGENTS.md → "Convex is the source of truth for instructor data" — drives the migration.
- Existing apps/platform admin patterns: `apps/platform/app/admin/{layout.tsx, client-admin-layout.tsx, error.tsx, page.tsx, instructors/page.tsx, orders/page.tsx}`.
- Existing apps/platform providers: `apps/platform/lib/providers/query-provider.tsx`, `apps/platform/components/convex-client-provider.tsx`.

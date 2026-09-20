# Plan: Mirror apps/platform admin UI in apps/marketing (Convex migration)

**Status:** PR 1 merged (#854); PR 2 merged (#855, Greptile 5/5 on commit `dfd02516`); PR 3 merged (#856, Greptile 5/5 on commit `643327a1`); PR 4 merged (#857, Greptile 5/5 on commit `c4ea241c`); PR 5 in progress on branch `feat/marketing-admin-orders`; PRs 6–7 planned.
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
| 6 | `feat/marketing-admin-inventory` | feat(marketing): port /admin/inventory to Convex | Pending | Marketing-only page. Move inventory data to Convex (`api.adminInventory.*`) so the data layer is single-source. |
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
| `convex/admin.ts` | `getOrdersForAdminCursor` | query | Cursor-paginated orders list (`paginationOpts`, optional `search`/`statusFilter`). Admin-gated. Uses `by_status` index when `statusFilter` is set, otherwise the `_creationTime` primary index with `.order("desc")`. Joins payments via `by_orderId` per page. |
| `convex/admin.ts` | `isAdmin` | internalQuery | Admin check for actions (which can't read `ctx.db` directly). |
| `convex/orders.ts` | `getOrderByIdInternal` | internalQuery | Lookup used by the refund action to find the order for the email. |
| `convex/payments.ts` | `getPaymentByIdInternal` | internalQuery | Lookup used by the refund action. |
| `convex/payments.ts` | `adminProcessRefundInternal` | internalMutation | Admin-gated DB update (status flips + audit log). The existing public `adminProcessRefund` is kept because platform + web admin API routes still call it. |
| `convex/adminRefunds.ts` *(new)* | `processRefundForAdmin` | action (`"use node"`) | Public action: admin-gate → load payment → compute refund amount → call Stripe/PayPal with idempotency key → call internal mutation → best-effort send refund email via Resend. |

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

5 new functions need a manual `CONVEX_DEPLOYMENT=prod:fine-bulldog-260 npx convex@1.45.0 deploy` after merge. Tracking issue: **HUC-36** (state `Backlog` → `In Progress` after merge).

### 5.3 Convex prod deploy — manual step (operational note)

CI's `convex-codegen` job only generates `_generated/` artifacts; it does NOT push new functions to prod. Each PR that adds/updates `convex/*.ts` functions requires a manual prod deploy:

```bash
CONVEX_DEPLOYMENT=prod:fine-bulldog-260 npx convex@1.45.0 deploy
```

(or the equivalent for a different prod deployment). Use the dev deployment (`acoustic-kiwi-522`) for development; CI's codegen job uses `CONVEX_DEPLOYMENT=production`.

**PR 4 deploy (2026-09-20 13:50 UTC):** +24 functions (619 → 643). Verified `admin.js:getInstructorsWithStatsForAdmin`, `getInstructorWithStudents`, `getFullAdminCsvData`, `incrementRemainingSessions` reachable in prod function spec.

Future PRs in this arc (5–7) must follow the same pattern. Greptile/CI will pass on the PR even if the prod deploy was missed — verification only happens via the production function spec, not the CI build.

---

## 6. References

- AGENTS.md → "Naming Conventions: NEVER use mentor/mentee" — `instructor`/`student` everywhere.
- AGENTS.md → "Pull Request Merge Policy" — Greptile + CodeRabbit (skip if `<10` stars); squash merge.
- AGENTS.md → "Schema-changing PR convention" — Linear verification issue.
- AGENTS.md → "Clerk Changes Policy (Do Not Touch)" — PR 2 *did* change Clerk-related code (introduced `clerkClient()` calls and shifted admin auth from email allowlist to Clerk claims). The user explicitly approved this exception at the start of the arc, with the understanding that the marketing admin role model should mirror apps/platform. PRs 3–7 should not introduce additional Clerk changes.
- AGENTS.md → "Convex is the source of truth for instructor data" — drives the migration.
- Existing apps/platform admin patterns: `apps/platform/app/admin/{layout.tsx, client-admin-layout.tsx, error.tsx, page.tsx, instructors/page.tsx, orders/page.tsx}`.
- Existing apps/platform providers: `apps/platform/lib/providers/query-provider.tsx`, `apps/platform/components/convex-client-provider.tsx`.

# Plan: Mirror apps/platform admin UI in apps/marketing (Convex migration)

**Status:** PR 1 merged; PRs 2–7 planned.  
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
| 2 | `feat/marketing-admin-layout` | feat(marketing): replace admin layout + sidebar with apps/platform's pattern | ⏳ Next | Replace `app/admin/layout.tsx` `requireRole("admin")` + email allowlist with `getDbUser()` + role check. Copy `client-admin-layout.tsx` sidebar from apps/platform. |
| 3 | `feat/marketing-admin-dashboard` | feat(marketing): port /admin dashboard to Convex | Pending | Mirror apps/platform `app/admin/page.tsx` (admin stats, quick links, sign-out). |
| 4 | `feat/marketing-admin-instructors` | feat(marketing): port /admin/instructors to Convex | Pending | Mirror apps/platform `app/admin/instructors/page.tsx` (`useAllInstructors` + `deleteAdminInstructor` + `BackfillImagesPanel`). This is the page that fixes the original 500. |
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

This is the next PR to land. Files:

- `apps/marketing/app/admin/layout.tsx` — replace `requireRole("admin")` + email allowlist with apps/platform's pattern:
  ```ts
  const user = await getDbUser();
  if (user.role !== "admin") redirect("/dashboard?error=unauthorized");
  ```
- `apps/marketing/app/admin/client-admin-layout.tsx` (new) — copy of apps/platform's client layout. Sidebar nav items: Dashboard, Instructors, Students, Products, Orders, Onboardings, Workspaces, Email Health, Audit Logs. (Students / Products / Onboardings / Workspaces / Email Health / Audit Logs will 404 until later PRs land — that's acceptable, the routes are reachable via sidebar as soon as their PRs merge.)
- `apps/marketing/lib/auth.ts` — keep `requireAdmin()` (used in marketing-only server-component pages), but add a `requireRoleFromClerk()` mirror of apps/platform's `requireRole` for use in the admin layout.

Risks:
- Marketing users in `DEFAULT_ADMIN_EMAILS` (currently `admin@huckleberry.art`) without a Clerk `publicMetadata.role === "admin"` claim will lose admin access. Verify the user's Clerk role claim before merging.
- The redirect target `/dashboard?error=unauthorized` doesn't exist in apps/marketing; apps/marketing's `next.config.ts` redirects `/dashboard` → `/`. Update redirect target to `/` for the marketing context, or restore `/dashboard` as a marketing stub.

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

---

## 6. References

- AGENTS.md → "Naming Conventions: NEVER use mentor/mentee" — `instructor`/`student` everywhere.
- AGENTS.md → "Pull Request Merge Policy" — Greptile + CodeRabbit (skip if `<10` stars); squash merge.
- AGENTS.md → "Schema-changing PR convention" — Linear verification issue.
- AGENTS.md → "Clerk Changes Policy (Do Not Touch)" — no Clerk code changes without explicit user approval; PRs 2–7 do not change Clerk.
- AGENTS.md → "Convex is the source of truth for instructor data" — drives the migration.
- Existing apps/platform admin patterns: `apps/platform/app/admin/{layout.tsx, client-admin-layout.tsx, page.tsx, instructors/page.tsx, orders/page.tsx}`.
- Existing apps/platform providers: `apps/platform/lib/providers/query-provider.tsx`, `apps/platform/components/convex-client-provider.tsx`.

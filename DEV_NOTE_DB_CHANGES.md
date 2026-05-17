DB Changes via Supabase CLI (Widen-Migrate-Narrow)

Context
- Convex is the source of truth for application data.
- Postgres exists for analytics/reporting and selected edge cases (e.g., RLS-gated product catalog reads).
- We keep Postgres schemas simple and derived from Convex where possible.

Process
1. Widen: Add nullable columns and indexes. Keep app behavior unchanged.
2. Migrate: Backfill deterministically from existing sources (prefer joins through user_id / payment/order chains). Avoid guesses.
3. Narrow: Once verified, tighten constraints/policies and remove legacy paths.

Conventions
- Commit SQL migrations under packages/db/drizzle and apply with Supabase CLI in CI.
- Avoid drizzle-kit generate in CI.
- Prefer server-role-only writes on public catalogs (example: mentorship_products) with public SELECT RLS.

Recent Changes
- 0029_server_role_only_writes_mentorship_products.sql: Ensures only public SELECT policy exists; drops any write policies.
- backfill-convex-and-instructor-ids task: Populates instructor_id/convex_id using deterministic joins (payments/orders/session_packs/instructors/instructor_integrations). Skips any mapping that isn’t provably correct.

Verification
- Run pnpm check and test suites.
- Spot checks:
  - SELECT COUNT(*) FROM mentorship_products WHERE instructor_id IS NULL;
  - SELECT COUNT(*) FROM sessions WHERE instructor_id IS NULL;
- Exercise onboarding submit/review/signed-urls flows end to end.

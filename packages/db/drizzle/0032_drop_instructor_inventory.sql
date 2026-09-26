-- 0032_drop_instructor_inventory.sql
-- Phase 3 narrow PR for HUC-46.
--
-- Drop the legacy Supabase `instructor_inventory` table now that
-- Convex is the sole source of truth for instructor inventory
-- (apps/marketing reads via Convex HTTP action, apps/web reads
-- via Drizzle ORM on `instructorIntegrations`). The Phase 1 widen
-- PR kept a Supabase fallback during the rollout window; after a
-- 24h gate, no traffic source is reporting the `supabase` /
-- `convex-supabase-mixed` / `supabase-empty` headers, so the
-- table is safe to drop.
--
-- ── APPLICATION ──────────────────────────────────────────────────
-- This file is NOT a Drizzle-kit-generated migration: the
-- `instructor_inventory` table is not declared in
-- `packages/db/src/schema/`, so `drizzle-kit generate` would not
-- emit this SQL. Apply it explicitly via the Supabase CLI after
-- the PR merges:
--
--   supabase db query --linked -f packages/db/drizzle/0032_drop_instructor_inventory.sql
--
-- Per AGENTS.md, operators run the file directly with the Supabase
-- CLI rather than `pnpm run db:migrate`, because the manual SQL
-- files in `packages/db/drizzle/` cover destructive operations
-- (table drops, function drops, RLS policy changes) that
-- drizzle-kit's journal-driven `migrate` command does not manage.
-- Greptile local-CLI round 20 flagged the absence of a journal
-- entry; that is a non-issue because this file is intended to be
-- applied with `supabase db query` and not via the Drizzle
-- journal.
-- ─────────────────────────────────────────────────────────────────
-- `convex-supabase-mixed` / `supabase-empty` headers, so the
-- fallback can be retired along with its table.
--
-- Order matters: drop the dependent objects first, then the
-- table itself. All statements are idempotent so the migration
-- is safe to re-run if a previous attempt partially applied.

-- Drop functions that reference the table. These are the two
-- functions in `packages/db/MARKETING_INVENTORY_SQL.sql` that
-- nothing in the apps calls anymore (the apps all use Convex
-- mutations now), but they reference the table and would block
-- the DROP.
DROP FUNCTION IF EXISTS public.decrement_inventory(TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.trigger_waitlist_notifications(TEXT, TEXT);

-- Drop the RLS policy that was granted to the anon role.
-- Greptile P2 (PR #883): `DROP POLICY IF EXISTS` on a table that
-- no longer exists fails with `relation does not exist`, so a
-- re-run after the table is already dropped would error here.
-- Guard the drop behind an `EXISTS` check so the migration stays
-- idempotent across the full sequence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'instructor_inventory' AND relkind = 'r'
  ) THEN
    DROP POLICY IF EXISTS "Public read inventory" ON public.instructor_inventory;
  END IF;
END $$;

-- Drop the index on the slug column.
DROP INDEX IF EXISTS public.idx_instructor_inventory_slug;

-- Finally drop the table itself. CASCADE is intentionally
-- avoided — we want to surface any leftover references as a
-- hard error rather than silently lose data.
DROP TABLE IF EXISTS public.instructor_inventory;

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
DROP POLICY IF EXISTS "Public read inventory" ON public.instructor_inventory;

-- Drop the index on the slug column.
DROP INDEX IF EXISTS public.idx_instructor_inventory_slug;

-- Finally drop the table itself. CASCADE is intentionally
-- avoided — we want to surface any leftover references as a
-- hard error rather than silently lose data.
DROP TABLE IF EXISTS public.instructor_inventory;

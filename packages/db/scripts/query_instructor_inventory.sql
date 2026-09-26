-- Read-only comparison helper used during post-merge verification
-- of the HUC-46 Convex→Supabase inventory backfill (PR #880 / #882).
--
-- Run via:
--   supabase db query --linked -f packages/db/scripts/query_instructor_inventory.sql
--
-- Override the slug filter inline (the WHERE clause below is the
-- canonical example — replace with the slug(s) you need to inspect).
-- This file is intentionally read-only; no writes.

select
  instructor_slug,
  one_on_one_inventory,
  group_inventory
from instructor_inventory
where instructor_slug = '<SLUG>'
order by instructor_slug;

-- Tighten RLS on mentorship_products to server-role-only writes
-- Idempotent: keeps public SELECT, removes any INSERT/UPDATE/DELETE policies
-- Assumes Convex is source of truth; app writes use service role only

begin;

-- Ensure RLS is enabled
alter table public.mentorship_products enable row level security;

-- Drop any lingering write policies (INSERT/UPDATE/DELETE)
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname='public' and tablename='mentorship_products' and cmd in ('INSERT','UPDATE','DELETE')
  loop
    execute format('drop policy %I on public.mentorship_products', pol.policyname);
  end loop;
end $$;

-- Ensure public read policy exists
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='mentorship_products'
      and policyname='Public read access to mentorship_products'
      and cmd='SELECT'
  ) then
    execute 'create policy "Public read access to mentorship_products" on public.mentorship_products for select using (true)';
  end if;
end $$;

commit;

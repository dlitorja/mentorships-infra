-- Enable RLS on __drizzle_migrations table flagged by Supabase Security Advisor
-- Migration: 0018_enable_rls_drizzle_migrations

-- Enable RLS on __drizzle_migrations
-- This is an internal Drizzle Kit table - restrict to service role only
ALTER TABLE __drizzle_migrations ENABLE ROW LEVEL SECURITY;

-- Only service role can access the migrations table
CREATE POLICY "Service role can read drizzle migrations" ON __drizzle_migrations
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "Service role can write drizzle migrations" ON __drizzle_migrations
  FOR ALL USING (auth.role() = 'service_role');

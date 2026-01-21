-- Enable RLS on tables flagged by Supabase Security Advisor
-- Migration: 0017_enable_rls_security_advisor

-- Enable RLS on admin_digest_settings
-- Only allow SELECT (public read); INSERT/UPDATE/DELETE denied by default
-- Writes must be done via service role (bypasses RLS)
ALTER TABLE admin_digest_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to admin digest settings" ON admin_digest_settings
  FOR SELECT USING (true);

-- Enable RLS on inventory_change_log
-- Only allow SELECT (public read); INSERT/UPDATE/DELETE denied by default
ALTER TABLE inventory_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to inventory change log" ON inventory_change_log
  FOR SELECT USING (true);

-- Enable RLS on kajabi_offers
-- Only allow SELECT (public read); INSERT/UPDATE/DELETE denied by default
ALTER TABLE kajabi_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to kajabi offers" ON kajabi_offers
  FOR SELECT USING (true);

-- Enable RLS on tables flagged by Supabase Security Advisor
-- Migration: 0017_enable_rls_security_advisor

-- Enable RLS on admin_digest_settings
-- Public read access; service role for writes
ALTER TABLE admin_digest_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to admin digest settings" ON admin_digest_settings
  FOR SELECT USING (true);
CREATE POLICY "Service role can manage digest settings" ON admin_digest_settings
  FOR ALL USING (auth.role() = 'service_role');

-- Enable RLS on inventory_change_log
-- Public read access; service role for writes (audit log entries)
ALTER TABLE inventory_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to inventory change log" ON inventory_change_log
  FOR SELECT USING (true);
CREATE POLICY "Service role can write inventory change log" ON inventory_change_log
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Enable RLS on kajabi_offers
-- Public read access; service role for writes
ALTER TABLE kajabi_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to kajabi offers" ON kajabi_offers
  FOR SELECT USING (true);
CREATE POLICY "Service role can manage kajabi offers" ON kajabi_offers
  FOR ALL USING (auth.role() = 'service_role');

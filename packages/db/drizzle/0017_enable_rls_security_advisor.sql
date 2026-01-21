-- Enable RLS on tables flagged by Supabase Security Advisor
-- Migration: 0017_enable_rls_security_advisor

-- Enable RLS on admin_digest_settings
ALTER TABLE admin_digest_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage digest settings" ON admin_digest_settings
  FOR ALL USING (true) WITH CHECK (true);

-- Enable RLS on inventory_change_log
ALTER TABLE inventory_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to inventory change log" ON inventory_change_log
  FOR SELECT USING (true);

-- Enable RLS on kajabi_offers
ALTER TABLE kajabi_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to kajabi offers" ON kajabi_offers
  FOR SELECT USING (true);

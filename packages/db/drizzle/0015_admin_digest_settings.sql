-- Create admin_digest_settings table for managing weekly digest configuration
CREATE TABLE IF NOT EXISTS admin_digest_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  admin_email TEXT NOT NULL,
  last_sent_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Insert default settings (admin email should be updated by admin)
INSERT INTO admin_digest_settings (id, enabled, frequency, admin_email)
VALUES ('default', true, 'weekly', 'admin@example.com')
ON CONFLICT (id) DO NOTHING;

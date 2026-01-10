-- Create inventory_change_log table for tracking inventory changes
CREATE TABLE IF NOT EXISTS inventory_change_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_slug TEXT NOT NULL,
  mentorship_type TEXT CHECK (mentorship_type IN ('one-on-one', 'group', NULL)),
  change_type TEXT NOT NULL CHECK (change_type IN ('manual_update', 'kajabi_purchase')),
  old_value INTEGER NOT NULL,
  new_value INTEGER NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT now(),
  changed_by TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_inventory_change_log_instructor ON inventory_change_log(instructor_slug);
CREATE INDEX IF NOT EXISTS idx_inventory_change_log_changed_at ON inventory_change_log(changed_at);
CREATE INDEX IF NOT EXISTS idx_inventory_change_log_type ON inventory_change_log(change_type);

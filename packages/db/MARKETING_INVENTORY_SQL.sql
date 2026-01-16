-- Marketing App Inventory Management Tables
-- Run this in Supabase SQL Editor

-- Instructor Inventory Table
-- Tracks inventory counts for each instructor by type
CREATE TABLE IF NOT EXISTS instructor_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_slug TEXT NOT NULL UNIQUE,
  one_on_one_inventory INTEGER NOT NULL DEFAULT 0,
  group_inventory INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_instructor_inventory_slug ON instructor_inventory(instructor_slug);

-- Kajabi Offer Mappings
-- Maps Kajabi offer IDs to instructor slugs and mentorship types
CREATE TABLE IF NOT EXISTS kajabi_offer_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id TEXT NOT NULL UNIQUE,
  instructor_slug TEXT NOT NULL,
  mentorship_type TEXT NOT NULL CHECK (mentorship_type IN ('one-on-one', 'group')),
  kajabi_offer_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for offer lookups
CREATE INDEX IF NOT EXISTS idx_kajabi_offer_mappings_offer_id ON kajabi_offer_mappings(offer_id);
CREATE INDEX IF NOT EXISTS idx_kajabi_offer_mappings_slug ON kajabi_offer_mappings(instructor_slug);

-- Waitlist Table (for marketing app)
-- Separate from the main app's waitlist to avoid schema issues
CREATE TABLE IF NOT EXISTS marketing_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  instructor_slug TEXT NOT NULL,
  mentorship_type TEXT NOT NULL CHECK (mentorship_type IN ('one-on-one', 'group')),
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  last_notification_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_waitlist_entry UNIQUE (email, instructor_slug, mentorship_type)
);

-- Index for waitlist queries
CREATE INDEX IF NOT EXISTS idx_marketing_waitlist_instructor ON marketing_waitlist(instructor_slug);
CREATE INDEX IF NOT EXISTS idx_marketing_waitlist_notified ON marketing_waitlist(notified);

-- Database Functions for atomic operations

-- Decrement inventory atomically (returns true if successful, false if not enough inventory)
CREATE OR REPLACE FUNCTION decrement_inventory(
  slug_param TEXT,
  inventory_column TEXT,
  decrement_by INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  new_value INTEGER;
  current_value INTEGER;
  valid_columns TEXT[] := ARRAY['one_on_one_inventory', 'group_inventory'];
BEGIN
  IF inventory_column NOT IN (SELECT unnest(valid_columns)) THEN
    RAISE EXCEPTION 'Invalid inventory_column value';
  END IF;

  EXECUTE format('SELECT %I FROM instructor_inventory WHERE instructor_slug = $1', inventory_column)
    INTO current_value
    USING slug_param;

  IF current_value IS NULL THEN
    RETURN FALSE;
  END IF;

  IF current_value < decrement_by THEN
    RETURN FALSE;
  END IF;

  new_value := current_value - decrement_by;

  EXECUTE format('UPDATE instructor_inventory SET %I = $1, updated_at = NOW() WHERE instructor_slug = $2', inventory_column)
    USING new_value, slug_param;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Trigger waitlist notifications for an instructor/type
-- Returns the count of notifications sent
CREATE OR REPLACE FUNCTION trigger_waitlist_notifications(
  slug_param TEXT,
  type_param TEXT
) RETURNS INTEGER AS $$
DECLARE
  notification_count INTEGER := 0;
  one_week_ago TIMESTAMP WITH TIME ZONE := NOW() - INTERVAL '7 days';
  waitlist_entry RECORD;
  instructor_row RECORD;
  purchase_url TEXT;
BEGIN
  -- Get instructor info
  SELECT * INTO instructor_row FROM instructor_inventory WHERE instructor_slug = slug_param;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Get the Kajabi offer URL
  SELECT kajabi_offer_url INTO purchase_url
  FROM kajabi_offer_mappings
  WHERE instructor_slug = slug_param AND mentorship_type = type_param
  LIMIT 1;

  -- Get waiting users (not notified in the last week)
  FOR waitlist_entry IN
    SELECT * FROM marketing_waitlist
    WHERE instructor_slug = slug_param
    AND mentorship_type = type_param
    AND (notified = FALSE OR last_notification_at < one_week_ago)
  LOOP
    -- TODO: Send email notification here (or call Edge Function)
    -- For now, just mark them as notified
    UPDATE marketing_waitlist
    SET notified = TRUE, last_notification_at = NOW(), updated_at = NOW()
    WHERE id = waitlist_entry.id;

    notification_count := notification_count + 1;
  END LOOP;

  RETURN notification_count;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE instructor_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE kajabi_offer_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_waitlist ENABLE ROW LEVEL SECURITY;

-- Public read access (for marketing site)
CREATE POLICY "Public read inventory" ON instructor_inventory FOR SELECT USING (true);
CREATE POLICY "Public read offers" ON kajabi_offer_mappings FOR SELECT USING (true);
CREATE POLICY "Public read waitlist" ON marketing_waitlist FOR SELECT USING (true);

-- Admin write access (authenticated users with admin role)
-- Note: Client-side enforcement, API routes will handle actual auth

-- Insert initial inventory records for existing instructors
-- These should match the slugs in apps/marketing/lib/instructors.ts
INSERT INTO instructor_inventory (instructor_slug, one_on_one_inventory, group_inventory) VALUES
  ('jordan-jardine', 3, 0),
  ('rakasa', 5, 8),
  ('lily-ghost', 2, 0),
  ('cameron-nissen', 0, 0),
  ('nino-vecia', 0, 0),
  ('oliver-titley', 0, 0),
  ('malina-dowling', 0, 0),
  ('amanda-kiefer', 0, 0),
  ('neil-gray', 0, 0),
  ('ash-kirk', 0, 0),
  ('andrea-sipl', 0, 0),
  ('kimea-zizzari', 0, 0),
  ('keven-mallqui', 0, 0)
ON CONFLICT (instructor_slug) DO NOTHING;

-- Insert sample offer mappings (update with real Kajabi offer IDs)
INSERT INTO kajabi_offer_mappings (offer_id, instructor_slug, mentorship_type, kajabi_offer_url) VALUES
  ('jordan-1on1', 'jordan-jardine', 'one-on-one', 'https://huckleberryart.kajabi.com/offers/jordan-1on1'),
  ('rakasa-1on1', 'rakasa', 'one-on-one', 'https://huckleberryart.kajabi.com/offers/rakasa-1on1'),
  ('rakasa-group', 'rakasa', 'group', 'https://huckleberryart.kajabi.com/offers/rakasa-group'),
  ('lily-1on1', 'lily-ghost', 'one-on-one', 'https://huckleberryart.kajabi.com/offers/lily-1on1')
ON CONFLICT (offer_id) DO NOTHING;

-- Migration for waitlist table improvements
-- Run this manually: psql $DATABASE_URL < MIGRATION_0012_WAITLIST_INDEXES.sql

-- Create index on userId for efficient lookups
CREATE INDEX IF NOT EXISTS "waitlist_user_id_idx" ON "waitlist" USING btree ("user_id");

-- Create composite index on (email, instructorSlug, type) for fast reads
CREATE INDEX IF NOT EXISTS "waitlist_email_instructor_type_idx" ON "waitlist" USING btree ("email", "instructor_slug", "type");

-- Create unique constraint on (email, instructorSlug, type) to prevent duplicates
-- This prevents race-condition duplicates
DO $$
BEGIN
ALTER TABLE "waitlist"
ADD CONSTRAINT IF NOT EXISTS "unique_waitlist_entry"
UNIQUE ("email", "instructor_slug", "type")
ON CONFLICT DO NOTHING;
EXCEPTION
WHEN duplicate_table THEN
  -- Constraint already exists, ignore
  NULL;
END $$;

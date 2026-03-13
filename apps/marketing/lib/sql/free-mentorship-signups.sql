-- Create table for free mentorship signups
-- Run this in Supabase SQL Editor

-- Drop table if exists (to start fresh)
DROP TABLE IF EXISTS free_mentorship_signups;

CREATE TABLE free_mentorship_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  portfolio_url TEXT,
  time_zone TEXT NOT NULL,
  art_goals TEXT NOT NULL,
  instructor_slug TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by instructor
CREATE INDEX idx_free_mentorship_signups_instructor 
ON free_mentorship_signups(instructor_slug);

-- Index for querying by email (for duplicate checking)
CREATE INDEX idx_free_mentorship_signups_email 
ON free_mentorship_signups(email);

-- Unique constraint: one signup per email per instructor
ALTER TABLE free_mentorship_signups 
ADD CONSTRAINT unique_free_mentorship_signup 
UNIQUE (email, instructor_slug);

-- Enable RLS
ALTER TABLE free_mentorship_signups ENABLE ROW LEVEL SECURITY;

-- Policy: allow anyone to insert (public form submission)
CREATE POLICY "Allow public inserts" ON free_mentorship_signups
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- Policy: allow anyone to view (for admin export)
CREATE POLICY "Allow public select" ON free_mentorship_signups
FOR SELECT TO anon, authenticated
USING (true);

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
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_timestamp TIMESTAMPTZ,
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

-- Function to update consent (bypasses RLS, used by API)
CREATE OR REPLACE FUNCTION update_consent(
  p_email TEXT,
  p_instructor_slug TEXT,
  p_consent BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE free_mentorship_signups
  SET consent = p_consent,
      consent_timestamp = CASE WHEN p_consent THEN NOW() ELSE consent_timestamp END
  WHERE email = p_email AND instructor_slug = p_instructor_slug;
END;
$$;

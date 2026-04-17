-- Add email column to instructors table for Clerk invitation workflow
ALTER TABLE instructors ADD COLUMN email TEXT;

-- Add index for faster lookups when matching Clerk users to instructors
CREATE INDEX IF NOT EXISTS instructors_email_idx ON instructors (email);

-- Backfill email from existing mentor relationships
-- This assumes mentors have a user_id that links to the users table which has email
UPDATE instructors
SET email = (
  SELECT u.email
  FROM mentors m
  JOIN users u ON m.user_id = u.id
  WHERE m.id = instructors.mentor_id
)
WHERE instructors.email IS NULL AND instructors.mentor_id IS NOT NULL;

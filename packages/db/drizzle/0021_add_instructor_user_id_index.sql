-- Add index on user_id for instructors table to improve query performance
-- getInstructorByUserId is called on every authenticated instructor API request
CREATE INDEX IF NOT EXISTS instructors_user_id_idx ON instructors (user_id);

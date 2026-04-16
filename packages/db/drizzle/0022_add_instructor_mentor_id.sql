-- Add mentorId column to instructors table to link with mentors table
ALTER TABLE instructors ADD COLUMN mentor_id UUID REFERENCES mentors(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS instructors_mentor_id_idx ON instructors(mentor_id);

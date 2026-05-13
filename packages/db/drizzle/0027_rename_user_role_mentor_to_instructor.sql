-- Migration: Rename user_role enum value from 'mentor' to 'instructor'
-- This aligns the PostgreSQL enum with the TypeScript schema changes made in PR #266
--
-- IMPORTANT: Run this migration BEFORE deploying code changes that check for 'instructor' role
--
-- PostgreSQL 13+ supports ALTER TYPE ... RENAME VALUE syntax
-- For older versions, use the two-step approach (see commented fallback below)

-- Verify current state before migration
DO $$
DECLARE
    mentor_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO mentor_count FROM users WHERE role = 'mentor';
    RAISE NOTICE 'Found % users with role=mentor before migration', mentor_count;
END $$;

-- Rename the enum value (PostgreSQL 13+)
ALTER TYPE user_role RENAME VALUE 'mentor' TO 'instructor';

-- Alternative approach for older PostgreSQL (uncomment if RENAME VALUE fails):
/*
-- Step 1: Add new value
ALTER TYPE user_role ADD VALUE 'instructor';

-- Step 2: Update existing rows
UPDATE users SET role = 'instructor' WHERE role = 'mentor';

-- Step 3: Drop old value (must be done in separate transaction in some PostgreSQL versions)
ALTER TYPE user_role DROP VALUE 'mentor';
*/

-- Verify the rename was successful
DO $$
DECLARE
    instructor_count INTEGER;
    mentor_count_after INTEGER;
BEGIN
    SELECT COUNT(*) INTO instructor_count FROM users WHERE role = 'instructor';
    SELECT COUNT(*) INTO mentor_count_after FROM users WHERE role = 'mentor';
    RAISE NOTICE 'Migration complete: % users now have role=instructor, % users still have role=mentor',
        instructor_count, mentor_count_after;

    -- Assert no 'mentor' values remain
    IF mentor_count_after > 0 THEN
        RAISE EXCEPTION 'Migration failed: % users still have role=mentor', mentor_count_after;
    END IF;
END $$;
-- 0029_rename_discord_action_type_enum.sql
-- Idempotent migration to rename discord_action_type enum value
-- from 'assign_mentee_role' to 'assign_student_role'

DO $$
BEGIN
  -- Check if enum type exists
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'discord_action_type'
  ) THEN
    -- Only attempt rename if old value exists and new value does not
    IF EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'discord_action_type' AND e.enumlabel = 'assign_mentee_role'
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'discord_action_type' AND e.enumlabel = 'assign_student_role'
    ) THEN
      ALTER TYPE discord_action_type RENAME VALUE 'assign_mentee_role' TO 'assign_student_role';
    END IF;
  END IF;
END $$;

-- Update any rows still using the old value (defensive, guard against enum value absence)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'discord_action_type' AND e.enumlabel = 'assign_mentee_role'
  ) THEN
    EXECUTE 'UPDATE public.discord_action_queue SET type = ''assign_student_role'' WHERE type = ''assign_mentee_role''';
  END IF;
END $$;

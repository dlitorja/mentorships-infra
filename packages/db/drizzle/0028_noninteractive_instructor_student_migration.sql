-- 0028_noninteractive_instructor_student_migration.sql
-- Idempotent migration to reconcile instructor/student renames without interactive prompts.
-- Operations:
-- - Rename tables: mentors→instructor_integrations, mentee_*→student_*
-- - Add new columns (widen): instructor_id / convex_id / mentorship_type
-- - Create indexes & FKs where appropriate
-- - Rename discord_action_queue.mentor_user_id→instructor_user_id (if present)
-- - Drop obsolete mentor_id columns and related indexes/constraints if they still exist

-- Helper: check and rename table if target missing and source present
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.instructor_integrations') IS NULL AND to_regclass('public.mentors') IS NOT NULL THEN
    ALTER TABLE public.mentors RENAME TO instructor_integrations;
  END IF;

  IF to_regclass('public.student_results') IS NULL AND to_regclass('public.mentee_results') IS NOT NULL THEN
    ALTER TABLE public.mentee_results RENAME TO student_results;
  END IF;

  IF to_regclass('public.student_onboarding_submissions') IS NULL AND to_regclass('public.mentee_onboarding_submissions') IS NOT NULL THEN
    ALTER TABLE public.mentee_onboarding_submissions RENAME TO student_onboarding_submissions;
  END IF;

  IF to_regclass('public.student_invitations') IS NULL AND to_regclass('public.mentee_invitations') IS NOT NULL THEN
    ALTER TABLE public.mentee_invitations RENAME TO student_invitations;
  END IF;

  IF to_regclass('public.student_session_counts') IS NULL AND to_regclass('public.mentee_session_counts') IS NOT NULL THEN
    ALTER TABLE public.mentee_session_counts RENAME TO student_session_counts;
  END IF;
END $$;

-- mentorship_products: add instructor_id and index; FK to instructors(id)
ALTER TABLE public.mentorship_products ADD COLUMN IF NOT EXISTS instructor_id uuid;
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mentorship_products_instructor_id_instructors_id_fk'
  ) THEN
    ALTER TABLE public.mentorship_products
      ADD CONSTRAINT mentorship_products_instructor_id_instructors_id_fk
      FOREIGN KEY (instructor_id) REFERENCES public.instructors(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS mentorship_products_instructor_id_idx ON public.mentorship_products (instructor_id);

-- session_packs: add convex_id (text), instructor_id (text), mentorship_type
ALTER TABLE public.session_packs ADD COLUMN IF NOT EXISTS convex_id text;
ALTER TABLE public.session_packs ADD COLUMN IF NOT EXISTS instructor_id text;
ALTER TABLE public.session_packs ADD COLUMN IF NOT EXISTS mentorship_type text NOT NULL DEFAULT 'one-on-one';
CREATE INDEX IF NOT EXISTS session_packs_instructor_id_idx ON public.session_packs (instructor_id);

-- seat_reservations: add convex_id (text), instructor_id (text)
ALTER TABLE public.seat_reservations ADD COLUMN IF NOT EXISTS convex_id text;
ALTER TABLE public.seat_reservations ADD COLUMN IF NOT EXISTS instructor_id text;
CREATE INDEX IF NOT EXISTS seat_reservations_instructor_id_idx ON public.seat_reservations (instructor_id);

-- sessions: add instructor_id (uuid), index & FK
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS instructor_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_instructor_id_instructors_id_fk'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_instructor_id_instructors_id_fk
      FOREIGN KEY (instructor_id) REFERENCES public.instructors(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sessions_instructor_id_idx ON public.sessions (instructor_id);

-- student_onboarding_submissions: add instructor_id (uuid), index & FK
ALTER TABLE public.student_onboarding_submissions ADD COLUMN IF NOT EXISTS instructor_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_onboarding_submissions_instructor_id_instructors_id_fk'
  ) THEN
    ALTER TABLE public.student_onboarding_submissions
      ADD CONSTRAINT student_onboarding_submissions_instructor_id_instructors_id_fk
      FOREIGN KEY (instructor_id) REFERENCES public.instructors(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS student_onboarding_submissions_instructor_id_idx ON public.student_onboarding_submissions (instructor_id);

-- discord_action_queue: add/rename instructor_id and instructor_user_id; indexes & FK
ALTER TABLE public.discord_action_queue ADD COLUMN IF NOT EXISTS instructor_id uuid;
-- If mentor_id exists and instructor_id does not, rename mentor_id to instructor_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='discord_action_queue' AND column_name='mentor_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='discord_action_queue' AND column_name='instructor_id'
  ) THEN
    ALTER TABLE public.discord_action_queue RENAME COLUMN mentor_id TO instructor_id;
  END IF;
END $$;

ALTER TABLE public.discord_action_queue ADD COLUMN IF NOT EXISTS instructor_user_id text;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='discord_action_queue' AND column_name='mentor_user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='discord_action_queue' AND column_name='instructor_user_id'
  ) THEN
    ALTER TABLE public.discord_action_queue RENAME COLUMN mentor_user_id TO instructor_user_id;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'discord_action_queue_instructor_id_instructors_id_fk'
  ) THEN
    ALTER TABLE public.discord_action_queue
      ADD CONSTRAINT discord_action_queue_instructor_id_instructors_id_fk
      FOREIGN KEY (instructor_id) REFERENCES public.instructors(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS discord_action_queue_instructor_id_idx ON public.discord_action_queue (instructor_id);

-- Drop obsolete mentor_id columns safely where they still exist
-- mentorship_products
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mentorship_products' AND column_name='mentor_id'
  ) THEN
    -- Drop old policies that reference mentor_id to avoid dependency errors
    IF EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mentorship_products' AND policyname='Mentors can insert own products'
    ) THEN
      DROP POLICY "Mentors can insert own products" ON public.mentorship_products;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mentorship_products' AND policyname='Mentors can update own products'
    ) THEN
      DROP POLICY "Mentors can update own products" ON public.mentorship_products;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mentorship_products' AND policyname='Users can view products'
    ) THEN
      DROP POLICY "Users can view products" ON public.mentorship_products;
    END IF;

    -- Drop dependent FKs first if any
    PERFORM 1 FROM pg_constraint WHERE conrelid = 'public.mentorship_products'::regclass AND conname = 'mentorship_products_mentor_id_fkey';
    IF FOUND THEN
      ALTER TABLE public.mentorship_products DROP CONSTRAINT IF EXISTS mentorship_products_mentor_id_fkey;
    END IF;
    -- Drop index if present
    DROP INDEX IF EXISTS idx_mentorship_products_mentor_id;
    DROP INDEX IF EXISTS mentorship_products_mentor_id_idx;
    ALTER TABLE public.mentorship_products DROP COLUMN IF EXISTS mentor_id CASCADE;

    -- Ensure RLS is enabled (idempotent)
    ALTER TABLE public.mentorship_products ENABLE ROW LEVEL SECURITY;

    -- Recreate policies using instructor_id (only if they don't already exist)
    PERFORM 1 FROM pg_policies WHERE schemaname='public' AND tablename='mentorship_products' AND policyname='Public read access to mentorship_products';
    IF NOT FOUND THEN
      EXECUTE 'CREATE POLICY "Public read access to mentorship_products" ON public.mentorship_products FOR SELECT USING (true)';
    END IF;

    -- Skipping insert/update policies here to avoid coupling to auth schema; server-side writes should use service role.
  END IF;
END $$;

-- sessions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sessions' AND column_name='mentor_id'
  ) THEN
    -- Drop old policies referencing mentor_id to avoid dependency errors
    IF EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sessions' AND policyname='Mentors can update student sessions'
    ) THEN
      DROP POLICY "Mentors can update student sessions" ON public.sessions;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sessions' AND policyname='Users and mentors can view sessions'
    ) THEN
      DROP POLICY "Users and mentors can view sessions" ON public.sessions;
    END IF;
    DROP INDEX IF EXISTS sessions_mentor_id_idx;
    ALTER TABLE public.sessions DROP COLUMN IF EXISTS mentor_id CASCADE;
  END IF;
END $$;

-- student_onboarding_submissions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='student_onboarding_submissions' AND column_name='mentor_id'
  ) THEN
    DROP INDEX IF EXISTS mentee_onboarding_submissions_mentor_id_idx;
    DROP INDEX IF EXISTS student_onboarding_submissions_mentor_id_idx;
    ALTER TABLE public.student_onboarding_submissions DROP COLUMN IF EXISTS mentor_id CASCADE;
  END IF;
END $$;

-- discord_action_queue
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='discord_action_queue' AND column_name='mentor_id'
  ) THEN
    -- If we didn't rename above, just drop now
    DROP INDEX IF EXISTS discord_action_queue_mentor_id_idx;
    ALTER TABLE public.discord_action_queue DROP COLUMN IF EXISTS mentor_id CASCADE;
  END IF;
END $$;

-- session_packs (text mentor_id may have existed historically)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='session_packs' AND column_name='mentor_id'
  ) THEN
    DROP INDEX IF EXISTS session_packs_mentor_id_idx;
    ALTER TABLE public.session_packs DROP COLUMN IF EXISTS mentor_id CASCADE;
  END IF;
END $$;

-- seat_reservations (text mentor_id may have existed historically)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='seat_reservations' AND column_name='mentor_id'
  ) THEN
    DROP INDEX IF EXISTS seat_reservations_mentor_id_idx;
    ALTER TABLE public.seat_reservations DROP COLUMN IF EXISTS mentor_id CASCADE;
  END IF;
END $$;

-- End of 0028

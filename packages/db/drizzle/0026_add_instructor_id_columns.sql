-- Phase 1.1: Add instructor_id columns (widen step)
-- This migration adds instructor_id columns alongside existing mentor_id columns
-- The mentor_id columns are kept for backward compatibility during the transition period

-- Add instructor_id to mentorship_products
ALTER TABLE "mentorship_products" ADD COLUMN "instructor_id" uuid;
ALTER TABLE "mentorship_products" ALTER COLUMN "instructor_id" DROP NOT NULL;
CREATE INDEX "mentorship_products_instructor_id_idx" ON "mentorship_products" USING btree ("instructor_id");
COMMENT ON COLUMN "mentorship_products"."instructor_id" IS 'References instructors.id - will replace mentor_id once migration is complete';

-- Add instructor_id to session_packs
ALTER TABLE "session_packs" ADD COLUMN "instructor_id" text;
ALTER TABLE "session_packs" ALTER COLUMN "instructor_id" DROP NOT NULL;
CREATE INDEX "session_packs_instructor_id_idx" ON "session_packs" USING btree ("instructor_id");
COMMENT ON COLUMN "session_packs"."instructor_id" IS 'References Convex instructor _id - will replace mentor_id once migration is complete';

-- Add instructor_id to seat_reservations
ALTER TABLE "seat_reservations" ADD COLUMN "instructor_id" text;
ALTER TABLE "seat_reservations" ALTER COLUMN "instructor_id" DROP NOT NULL;
CREATE INDEX "seat_reservations_instructor_id_idx" ON "seat_reservations" USING btree ("instructor_id");
COMMENT ON COLUMN "seat_reservations"."instructor_id" IS 'References Convex instructor _id - will replace mentor_id once migration is complete';

-- Add instructor_id to sessions
ALTER TABLE "sessions" ADD COLUMN "instructor_id" uuid;
ALTER TABLE "sessions" ALTER COLUMN "instructor_id" DROP NOT NULL;
CREATE INDEX "sessions_instructor_id_idx" ON "sessions" USING btree ("instructor_id");
COMMENT ON COLUMN "sessions"."instructor_id" IS 'References instructors.id - will replace mentor_id once migration is complete';

-- Add instructor_id to discord_action_queue
ALTER TABLE "discord_action_queue" ADD COLUMN "instructor_id" uuid;
ALTER TABLE "discord_action_queue" ALTER COLUMN "instructor_id" DROP NOT NULL;
CREATE INDEX "discord_action_queue_instructor_id_idx" ON "discord_action_queue" USING btree ("instructor_id");
COMMENT ON COLUMN "discord_action_queue"."instructor_id" IS 'References instructors.id - will replace mentor_id once migration is complete';

-- Add instructor_id to mentee_onboarding_submissions
ALTER TABLE "mentee_onboarding_submissions" ADD COLUMN "instructor_id" uuid;
ALTER TABLE "mentee_onboarding_submissions" ALTER COLUMN "instructor_id" DROP NOT NULL;
CREATE INDEX "mentee_onboarding_submissions_instructor_id_idx" ON "mentee_onboarding_submissions" USING btree ("instructor_id");
COMMENT ON COLUMN "mentee_onboarding_submissions"."instructor_id" IS 'References instructors.id - will replace mentor_id once migration is complete';

-- Add foreign key constraints for instructor_id columns (nullable, set null on delete)
-- These are added separately after the columns exist
ALTER TABLE "mentorship_products" ADD CONSTRAINT "mentorship_products_instructor_id_instructors_id_fk"
  FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_instructor_id_instructors_id_fk"
  FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "mentee_onboarding_submissions" ADD CONSTRAINT "mentee_onboarding_submissions_instructor_id_instructors_id_fk"
  FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "discord_action_queue" ADD CONSTRAINT "discord_action_queue_instructor_id_instructors_id_fk"
  FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE set null ON UPDATE no action;

-- Note: session_packs and seat_reservations use text type for instructor_id (Convex IDs are text)
-- so they don't have FK constraints - the values are Convex instructor document IDs
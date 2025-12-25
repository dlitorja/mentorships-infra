-- Migration 0009: Add indexes and soft deletion fields
-- Generated: 2025-01-XX
-- 
-- This migration adds:
-- 1. deleted_at fields for soft deletion on key tables
-- 2. Performance indexes on frequently queried fields
--
-- To apply manually:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Copy and paste this entire file
-- 3. Execute it

-- Add soft deletion fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "mentors" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "mentorship_products" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "session_packs" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- Add indexes for orders table
CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" USING btree ("status");
CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "orders_user_id_status_idx" ON "orders" USING btree ("user_id","status");

-- Add indexes for payments table
CREATE INDEX IF NOT EXISTS "payments_order_id_idx" ON "payments" USING btree ("order_id");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status");
CREATE INDEX IF NOT EXISTS "payments_provider_payment_id_idx" ON "payments" USING btree ("provider","provider_payment_id");

-- Add indexes for session_packs table
CREATE INDEX IF NOT EXISTS "session_packs_user_id_idx" ON "session_packs" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "session_packs_mentor_id_idx" ON "session_packs" USING btree ("mentor_id");
CREATE INDEX IF NOT EXISTS "session_packs_status_idx" ON "session_packs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "session_packs_expires_at_idx" ON "session_packs" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "session_packs_payment_id_idx" ON "session_packs" USING btree ("payment_id");
CREATE INDEX IF NOT EXISTS "session_packs_user_id_status_expires_at_idx" ON "session_packs" USING btree ("user_id","status","expires_at");

-- Add indexes for seat_reservations table
CREATE INDEX IF NOT EXISTS "seat_reservations_mentor_id_idx" ON "seat_reservations" USING btree ("mentor_id");
CREATE INDEX IF NOT EXISTS "seat_reservations_user_id_idx" ON "seat_reservations" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "seat_reservations_status_idx" ON "seat_reservations" USING btree ("status");
CREATE INDEX IF NOT EXISTS "seat_reservations_seat_expires_at_idx" ON "seat_reservations" USING btree ("seat_expires_at");

-- Add indexes for sessions table
CREATE INDEX IF NOT EXISTS "sessions_student_id_idx" ON "sessions" USING btree ("student_id");
CREATE INDEX IF NOT EXISTS "sessions_mentor_id_idx" ON "sessions" USING btree ("mentor_id");
CREATE INDEX IF NOT EXISTS "sessions_session_pack_id_idx" ON "sessions" USING btree ("session_pack_id");
CREATE INDEX IF NOT EXISTS "sessions_status_idx" ON "sessions" USING btree ("status");
CREATE INDEX IF NOT EXISTS "sessions_scheduled_at_idx" ON "sessions" USING btree ("scheduled_at");
CREATE INDEX IF NOT EXISTS "sessions_student_id_status_scheduled_at_idx" ON "sessions" USING btree ("student_id","status","scheduled_at");

-- Add indexes for discord_action_queue table
CREATE INDEX IF NOT EXISTS "discord_action_queue_status_idx" ON "discord_action_queue" USING btree ("status");
CREATE INDEX IF NOT EXISTS "discord_action_queue_subject_user_id_idx" ON "discord_action_queue" USING btree ("subject_user_id");
CREATE INDEX IF NOT EXISTS "discord_action_queue_mentor_id_idx" ON "discord_action_queue" USING btree ("mentor_id");
CREATE INDEX IF NOT EXISTS "discord_action_queue_status_created_at_idx" ON "discord_action_queue" USING btree ("status","created_at");


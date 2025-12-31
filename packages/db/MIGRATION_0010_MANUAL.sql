-- Migration 0010: Add composite indexes to seat_reservations table
-- This migration adds indexes to optimize queries filtering by mentorId/status and userId/mentorId

CREATE INDEX IF NOT EXISTS "seat_reservations_mentor_id_status_idx" ON "seat_reservations" USING btree ("mentor_id","status");
CREATE INDEX IF NOT EXISTS "seat_reservations_user_id_mentor_id_idx" ON "seat_reservations" USING btree ("user_id","mentor_id");

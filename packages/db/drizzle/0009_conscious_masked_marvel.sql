ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "mentors" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "mentorship_products" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "session_packs" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
CREATE INDEX "orders_user_id_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_user_id_status_idx" ON "orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_provider_payment_id_idx" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "session_packs_user_id_idx" ON "session_packs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_packs_mentor_id_idx" ON "session_packs" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "session_packs_status_idx" ON "session_packs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "session_packs_expires_at_idx" ON "session_packs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "session_packs_payment_id_idx" ON "session_packs" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "session_packs_user_id_status_expires_at_idx" ON "session_packs" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "seat_reservations_mentor_id_idx" ON "seat_reservations" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "seat_reservations_user_id_idx" ON "seat_reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "seat_reservations_status_idx" ON "seat_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seat_reservations_seat_expires_at_idx" ON "seat_reservations" USING btree ("seat_expires_at");--> statement-breakpoint
CREATE INDEX "sessions_student_id_idx" ON "sessions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "sessions_mentor_id_idx" ON "sessions" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "sessions_session_pack_id_idx" ON "sessions" USING btree ("session_pack_id");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_scheduled_at_idx" ON "sessions" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "sessions_student_id_status_scheduled_at_idx" ON "sessions" USING btree ("student_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "discord_action_queue_status_idx" ON "discord_action_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discord_action_queue_subject_user_id_idx" ON "discord_action_queue" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "discord_action_queue_mentor_id_idx" ON "discord_action_queue" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "discord_action_queue_status_created_at_idx" ON "discord_action_queue" USING btree ("status","created_at");
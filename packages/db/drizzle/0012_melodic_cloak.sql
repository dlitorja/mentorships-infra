CREATE INDEX "waitlist_user_id_idx" ON "waitlist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "waitlist_email_instructor_type_idx" ON "waitlist" USING btree ("email","instructor_slug","type");--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "unique_waitlist_entry" UNIQUE("email","instructor_slug","type");
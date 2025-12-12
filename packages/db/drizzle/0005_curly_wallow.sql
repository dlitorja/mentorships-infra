ALTER TABLE "mentors" ADD COLUMN "google_calendar_id" text;--> statement-breakpoint
ALTER TABLE "mentors" ADD COLUMN "google_refresh_token" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_google_calendar_event_id_unique" UNIQUE("google_calendar_event_id");
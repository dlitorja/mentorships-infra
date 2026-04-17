CREATE TABLE "mentee_session_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"instructor_id" uuid NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentee_session_counts" ADD CONSTRAINT "mentee_session_counts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentee_session_counts" ADD CONSTRAINT "mentee_session_counts_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mentee_session_counts_user_id_idx" ON "mentee_session_counts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mentee_session_counts_instructor_id_idx" ON "mentee_session_counts" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "mentee_session_counts_user_instructor_idx" ON "mentee_session_counts" USING btree ("user_id","instructor_id");
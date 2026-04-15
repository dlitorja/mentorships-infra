CREATE TABLE "instructor_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tagline" text,
	"bio" text,
	"specialties" text[],
	"background" text[],
	"profile_image_url" text,
	"profile_image_upload_path" text,
	"portfolio_images" text[],
	"socials" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instructors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "mentee_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"image_url" text,
	"image_upload_path" text,
	"student_name" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instructor_testimonials" ADD CONSTRAINT "instructor_testimonials_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentee_results" ADD CONSTRAINT "mentee_results_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentee_results" ADD CONSTRAINT "mentee_results_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instructor_testimonials_instructor_id_idx" ON "instructor_testimonials" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "instructor_testimonials_created_at_idx" ON "instructor_testimonials" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "instructors_slug_idx" ON "instructors" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "instructors_is_active_idx" ON "instructors" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "instructors_created_at_idx" ON "instructors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mentee_results_instructor_id_idx" ON "mentee_results" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "mentee_results_created_by_idx" ON "mentee_results" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "mentee_results_created_at_idx" ON "mentee_results" USING btree ("created_at");
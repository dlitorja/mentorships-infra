CREATE TYPE "public"."digest_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('pending', 'transferring', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'uploading', 'completed', 'archived', 'failed', 'deleted');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'video_editor';--> statement-breakpoint
CREATE TABLE "admin_digest_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"frequency" "digest_frequency" DEFAULT 'weekly' NOT NULL,
	"admin_email" text NOT NULL,
	"last_sent_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_editor_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"video_editor_id" text NOT NULL,
	"instructor_id" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructor_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"instructor_id" text NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"b2_file_id" text,
	"b2_upload_id" text,
	"b2_part_etags" text,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"archived_at" timestamp,
	"s3_key" text,
	"s3_url" text,
	"transfer_status" "transfer_status",
	"transfer_retry_count" integer DEFAULT 0,
	"notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "monthly_storage_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"b2_storage_cost" integer DEFAULT 0 NOT NULL,
	"b2_download_cost" integer DEFAULT 0 NOT NULL,
	"b2_api_cost" integer DEFAULT 0 NOT NULL,
	"s3_storage_cost" integer DEFAULT 0 NOT NULL,
	"s3_retrieval_cost" integer DEFAULT 0 NOT NULL,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"alert_sent" boolean DEFAULT false NOT NULL,
	"alert_threshold" integer DEFAULT 5000 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_packs" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "mentorship_products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "mentorship_products" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "mentorship_products" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "mentorship_products" ADD COLUMN "stripe_product_id" text;--> statement-breakpoint
ALTER TABLE "mentorship_products" ADD COLUMN "mentorship_type" text DEFAULT 'one-on-one' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_editor_assignments" ADD CONSTRAINT "video_editor_assignments_video_editor_id_users_id_fk" FOREIGN KEY ("video_editor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_editor_assignments" ADD CONSTRAINT "video_editor_assignments_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_editor_assignments" ADD CONSTRAINT "video_editor_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_uploads" ADD CONSTRAINT "instructor_uploads_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_editor_instructor_idx" ON "video_editor_assignments" USING btree ("video_editor_id","instructor_id");--> statement-breakpoint
CREATE INDEX "instructor_id_idx" ON "video_editor_assignments" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "instructor_uploads_instructor_id_idx" ON "instructor_uploads" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "instructor_uploads_status_idx" ON "instructor_uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "instructor_uploads_transfer_status_idx" ON "instructor_uploads" USING btree ("transfer_status");--> statement-breakpoint
CREATE INDEX "instructor_uploads_created_at_idx" ON "instructor_uploads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "instructor_uploads_status_created_at_idx" ON "instructor_uploads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "instructor_uploads_archived_at_idx" ON "instructor_uploads" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_storage_costs_month_idx" ON "monthly_storage_costs" USING btree ("month");
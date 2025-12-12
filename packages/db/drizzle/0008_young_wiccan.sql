CREATE TYPE "public"."identity_provider" AS ENUM('discord');--> statement-breakpoint
CREATE TYPE "public"."discord_action_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."discord_action_type" AS ENUM('assign_mentee_role', 'dm_instructor_new_signup');--> statement-breakpoint
CREATE TABLE "user_identities" (
	"user_id" text NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentee_onboarding_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"mentor_id" uuid NOT NULL,
	"session_pack_id" uuid NOT NULL,
	"goals" text NOT NULL,
	"image_objects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_action_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "discord_action_type" NOT NULL,
	"status" "discord_action_status" DEFAULT 'pending' NOT NULL,
	"subject_user_id" text NOT NULL,
	"mentor_id" uuid,
	"mentor_user_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentee_onboarding_submissions" ADD CONSTRAINT "mentee_onboarding_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentee_onboarding_submissions" ADD CONSTRAINT "mentee_onboarding_submissions_mentor_id_mentors_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."mentors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentee_onboarding_submissions" ADD CONSTRAINT "mentee_onboarding_submissions_session_pack_id_session_packs_id_fk" FOREIGN KEY ("session_pack_id") REFERENCES "public"."session_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentee_onboarding_submissions" ADD CONSTRAINT "mentee_onboarding_submissions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_action_queue" ADD CONSTRAINT "discord_action_queue_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_action_queue" ADD CONSTRAINT "discord_action_queue_mentor_id_mentors_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."mentors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_action_queue" ADD CONSTRAINT "discord_action_queue_mentor_user_id_users_id_fk" FOREIGN KEY ("mentor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_user_provider_unique" ON "user_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_user_unique" ON "user_identities" USING btree ("provider","provider_user_id");
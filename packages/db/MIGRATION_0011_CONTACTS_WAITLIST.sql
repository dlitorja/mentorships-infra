-- Migration for contacts and waitlist tables
-- Run this manually: psql $DATABASE_URL < MIGRATION_0011_CONTACTS_WAITLIST.sql

-- Create waitlist_type enum
CREATE TYPE "public"."waitlist_type" AS ENUM('one-on-one', 'group');

-- Create contacts table
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"art_goals" text,
	"source" text DEFAULT 'matching_form',
	"opted_in" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_unique" UNIQUE("email")
);

-- Create waitlist table
CREATE TABLE "waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"instructor_slug" text NOT NULL,
	"type" "waitlist_type" NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);

-- Create indexes for better query performance
CREATE INDEX "waitlist_user_id_idx" ON "waitlist"("user_id");
CREATE INDEX "waitlist_email_idx" ON "waitlist"("email");
CREATE INDEX "waitlist_instructor_type_idx" ON "waitlist"("instructor_slug", "type");
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

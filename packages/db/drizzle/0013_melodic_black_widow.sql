CREATE TABLE IF NOT EXISTS "kajabi_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"instructor_slug" text NOT NULL,
	"type" "waitlist_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentors" ADD COLUMN IF NOT EXISTS "one_on_one_inventory" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mentors" ADD COLUMN IF NOT EXISTS "group_inventory" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kajabi_offers_instructor_slug_idx" ON "kajabi_offers" USING btree ("instructor_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kajabi_offers_type_idx" ON "kajabi_offers" USING btree ("type");
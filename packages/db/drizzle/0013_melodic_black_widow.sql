CREATE TABLE "kajabi_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"instructor_slug" text NOT NULL,
	"type" "waitlist_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentors" ADD COLUMN "one_on_one_inventory" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mentors" ADD COLUMN "group_inventory" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX "kajabi_offers_instructor_slug_idx" ON "kajabi_offers" USING btree ("instructor_slug");
--> statement-breakpoint
CREATE INDEX "kajabi_offers_type_idx" ON "kajabi_offers" USING btree ("type");
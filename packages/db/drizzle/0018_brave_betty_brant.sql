CREATE TYPE "public"."mentee_invitation_status" AS ENUM('pending', 'accepted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "mentee_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"instructor_id" uuid NOT NULL,
	"clerk_invitation_id" text,
	"expires_at" timestamp NOT NULL,
	"status" "mentee_invitation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentee_invitations" ADD CONSTRAINT "mentee_invitations_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "mentee_invitations_email_idx" ON "mentee_invitations" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "mentee_invitations_instructor_id_idx" ON "mentee_invitations" USING btree ("instructor_id");
--> statement-breakpoint
CREATE INDEX "mentee_invitations_status_idx" ON "mentee_invitations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "mentee_invitations_clerk_invitation_id_idx" ON "mentee_invitations" USING btree ("clerk_invitation_id");

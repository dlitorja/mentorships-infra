CREATE TYPE "public"."user_role" AS ENUM('student', 'mentor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'refunded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'paypal');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'completed', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_pack_status" AS ENUM('active', 'depleted', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."seat_status" AS ENUM('active', 'grace', 'released');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('scheduled', 'completed', 'canceled', 'no_show');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "mentors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"max_active_students" integer DEFAULT 10 NOT NULL,
	"bio" text,
	"pricing" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mentors_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "mentorship_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mentor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"sessions_per_pack" integer DEFAULT 4 NOT NULL,
	"validity_days" integer DEFAULT 30 NOT NULL,
	"stripe_price_id" text,
	"paypal_product_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"refunded_amount" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mentor_id" uuid NOT NULL,
	"total_sessions" integer DEFAULT 4 NOT NULL,
	"remaining_sessions" integer DEFAULT 4 NOT NULL,
	"purchased_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" "session_pack_status" DEFAULT 'active' NOT NULL,
	"payment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seat_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mentor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_pack_id" uuid NOT NULL,
	"seat_expires_at" timestamp NOT NULL,
	"grace_period_ends_at" timestamp,
	"status" "seat_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mentor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"session_pack_id" uuid NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"canceled_at" timestamp,
	"status" "session_status" DEFAULT 'scheduled' NOT NULL,
	"recording_consent" boolean DEFAULT false NOT NULL,
	"recording_url" text,
	"recording_expires_at" timestamp,
	"google_calendar_event_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentors" ADD CONSTRAINT "mentors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorship_products" ADD CONSTRAINT "mentorship_products_mentor_id_mentors_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."mentors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_packs" ADD CONSTRAINT "session_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_packs" ADD CONSTRAINT "session_packs_mentor_id_mentors_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."mentors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_packs" ADD CONSTRAINT "session_packs_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_mentor_id_mentors_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."mentors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_session_pack_id_session_packs_id_fk" FOREIGN KEY ("session_pack_id") REFERENCES "public"."session_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_mentor_id_mentors_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."mentors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_session_pack_id_session_packs_id_fk" FOREIGN KEY ("session_pack_id") REFERENCES "public"."session_packs"("id") ON DELETE cascade ON UPDATE no action;
CREATE TABLE "google_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sub" text NOT NULL,
	"email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_sub_uq" ON "google_accounts" USING btree ("sub");--> statement-breakpoint
CREATE INDEX "password_failures_phone_idx" ON "password_failures" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "password_failures_ip_idx" ON "password_failures" USING btree ("ip_hash","created_at");
CREATE TYPE "public"."telegram_login_status" AS ENUM('pending', 'approved', 'consumed');--> statement-breakpoint
CREATE TABLE "telegram_logins" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"status" "telegram_login_status" DEFAULT 'pending' NOT NULL,
	"ui_locale" "ui_locale" DEFAULT 'uz-Latn' NOT NULL,
	"telegram_chat_id" text,
	"telegram_user_id" text,
	"phone" text,
	"ip_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_logins_token_uq" ON "telegram_logins" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "telegram_logins_chat_idx" ON "telegram_logins" USING btree ("telegram_chat_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_logins_ip_idx" ON "telegram_logins" USING btree ("ip_hash","created_at");
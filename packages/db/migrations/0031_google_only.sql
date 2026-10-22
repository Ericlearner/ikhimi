-- Telegram is gone (login, bot, support, bank transfers in the bot), and so are phone codes and passwords.
ALTER TABLE "otp_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_failures" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_threads" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_logins" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "otp_codes" CASCADE;--> statement-breakpoint
DROP TABLE "password_failures" CASCADE;--> statement-breakpoint
DROP TABLE "support_threads" CASCADE;--> statement-breakpoint
DROP TABLE "telegram_logins" CASCADE;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_packages" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payment_provider";--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('test');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "provider" SET DATA TYPE "public"."payment_provider" USING "provider"::"public"."payment_provider";--> statement-breakpoint
ALTER TABLE "plan_packages" ALTER COLUMN "provider" SET DATA TYPE "public"."payment_provider" USING "provider"::"public"."payment_provider";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "provider" SET DATA TYPE "public"."payment_provider" USING "provider"::"public"."payment_provider";--> statement-breakpoint
DROP INDEX "staff_members_phone_uq";--> statement-breakpoint
ALTER TABLE "help_questions" DROP COLUMN "handoff";--> statement-breakpoint
ALTER TABLE "staff_members" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "phone_verified_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "telegram_chat_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_set_at";--> statement-breakpoint
DROP TYPE "public"."telegram_login_status";
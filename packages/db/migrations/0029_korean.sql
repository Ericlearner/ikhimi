-- 익히미 starts here: the interface is Korean only, and the Uzbek payment providers (Payme, Click, Uzum) are gone.
ALTER TABLE "payments" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_packages" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payment_provider";--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('test', 'card');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "provider" SET DATA TYPE "public"."payment_provider" USING "provider"::"public"."payment_provider";--> statement-breakpoint
ALTER TABLE "plan_packages" ALTER COLUMN "provider" SET DATA TYPE "public"."payment_provider" USING "provider"::"public"."payment_provider";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "provider" SET DATA TYPE "public"."payment_provider" USING "provider"::"public"."payment_provider";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "ui_locale" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "telegram_logins" ALTER COLUMN "ui_locale" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "instruction_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ALTER COLUMN "ui_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "ui_locale" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."ui_locale";--> statement-breakpoint
CREATE TYPE "public"."ui_locale" AS ENUM('ko');--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "instruction_locale" SET DATA TYPE "public"."ui_locale" USING 'ko'::"public"."ui_locale";--> statement-breakpoint
ALTER TABLE "telegram_logins" ALTER COLUMN "ui_locale" SET DATA TYPE "public"."ui_locale" USING 'ko'::"public"."ui_locale";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "ui_locale" SET DATA TYPE "public"."ui_locale" USING 'ko'::"public"."ui_locale";--> statement-breakpoint
ALTER TABLE "telegram_logins" ALTER COLUMN "ui_locale" SET DEFAULT 'ko';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "ui_locale" SET DEFAULT 'ko';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "ui_script";

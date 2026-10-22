ALTER TABLE "responses" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_role" "user_role";--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD COLUMN "teaching_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Backfill: every existing account holds its primary role
UPDATE "users" SET "roles" = ARRAY["role"::text] WHERE cardinality("roles") = 0;

ALTER TABLE "responses" ADD COLUMN "tutor" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vip_until" timestamp with time zone;
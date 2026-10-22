ALTER TABLE "assignments" ADD COLUMN "due_days" smallint;--> statement-breakpoint
-- Homework that already has a date gets the same number of Tashkent days (UTC+5) between publishing and it, at least one
UPDATE "assignments" SET "due_days" = greatest(1, date(("due_at" at time zone 'UTC') + interval '5 hours') - date((coalesce("published_at", "created_at") at time zone 'UTC') + interval '5 hours')) WHERE "due_at" IS NOT NULL;

-- Sign-in is Google only (Apple in the iOS app): owners and staff are matched by the account's verified email.
-- Assistants added by phone number can't be matched any more; the owner adds them again by email.
DELETE FROM "staff_members";--> statement-breakpoint
ALTER TABLE "staff_members" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
UPDATE "users" SET "email" = lower(g."email") FROM "google_accounts" g
  WHERE g."user_id" = "users"."id" AND g."email" IS NOT NULL
  AND (SELECT count(*) FROM "google_accounts" o WHERE lower(o."email") = lower(g."email")) = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_email_uq" ON "staff_members" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");

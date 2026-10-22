ALTER TABLE "courses" ADD COLUMN "review_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Prices from before "no course sales" were ignored: no course becomes paid by itself
UPDATE "courses" SET "price_krw" = NULL;--> statement-breakpoint
-- Courses already open to others stay published (the owner can take one back in Admin → Kurslar)
UPDATE "courses" SET "review_status" = 'approved', "approved_at" = now() WHERE "visibility" <> 'private' AND "deleted_at" IS NULL;

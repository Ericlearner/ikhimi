ALTER TYPE "public"."payment_provider" ADD VALUE 'test';--> statement-breakpoint
ALTER TABLE "course_lessons" ADD COLUMN "is_preview" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_slug_uq" ON "courses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "courses_teacher_idx" ON "courses" USING btree ("teacher_id");
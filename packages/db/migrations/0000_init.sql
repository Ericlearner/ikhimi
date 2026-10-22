CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'submitted', 'graded');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."course_visibility" AS ENUM('private', 'unlisted', 'marketplace');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'invited', 'removed');--> statement-breakpoint
CREATE TYPE "public"."grading_mode" AS ENUM('auto', 'ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."material_kind" AS ENUM('image', 'audio', 'pdf', 'doc', 'link', 'text');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('teacher', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."pairing_reason" AS ENUM('filename', 'ocr_label', 'manual', 'ai');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('payme', 'click', 'uzum');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'pending', 'paid', 'cancelled', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'pending', 'active', 'grace', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ui_locale" AS ENUM('uz-Latn', 'uz-Cyrl', 'ru', 'en');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('teacher', 'student', 'admin');--> statement-breakpoint
CREATE TABLE "assignment_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"order_index" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"teacher_id" text NOT NULL,
	"group_id" text,
	"course_id" text,
	"order_index" integer,
	"title" text NOT NULL,
	"instructions" text,
	"instruction_locale" "ui_locale" NOT NULL,
	"content_language" text NOT NULL,
	"subject" text,
	"cefr_level" text,
	"difficulty" smallint,
	"estimated_minutes" smallint,
	"total_points" integer,
	"status" "assignment_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"share_slug" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generation_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"graded_at" timestamp with time zone,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"score" real,
	"max_score" real,
	"percent" real,
	"auto_graded_count" integer DEFAULT 0 NOT NULL,
	"ai_graded_count" integer DEFAULT 0 NOT NULL,
	"manual_pending_count" integer DEFAULT 0 NOT NULL,
	"integrity_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"device_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"group_id" text,
	"title" text,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "course_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"order_index" integer NOT NULL,
	"title" text NOT NULL,
	"assignment_template_id" text,
	"video_url" text,
	"video_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"group_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_lesson_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"subject" text,
	"content_language" text,
	"cefr_level" text,
	"cover_url" text,
	"lesson_count" integer DEFAULT 0 NOT NULL,
	"visibility" "course_visibility" DEFAULT 'private' NOT NULL,
	"price_krw" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"block_id" text,
	"order_index" integer NOT NULL,
	"kind" text NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"prompt" jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answer_key" jsonb NOT NULL,
	"rationale" text,
	"grading_mode" "grading_mode" DEFAULT 'auto' NOT NULL,
	"skill_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"method_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_material_id" text,
	"source_ref" text,
	"ai_confidence" real,
	"teacher_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"content_language" text NOT NULL,
	"cefr_level" text,
	"join_code" text NOT NULL,
	"students_see_leaderboard" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "material_links" (
	"id" text PRIMARY KEY NOT NULL,
	"audio_material_id" text NOT NULL,
	"source_material_id" text NOT NULL,
	"confidence" real NOT NULL,
	"reason" "pairing_reason" NOT NULL,
	"confirmed_by_teacher" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"group_id" text,
	"kind" "material_kind" NOT NULL,
	"original_filename" text,
	"storage_key" text,
	"mime_type" text,
	"bytes" integer,
	"duration_sec" real,
	"extracted_text" text,
	"extracted_structure" jsonb,
	"detected_labels" jsonb,
	"processing_status" "processing_status" DEFAULT 'pending_upload' NOT NULL,
	"processing_error" text,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"body" text NOT NULL,
	"attachments" text[] DEFAULT '{}'::text[] NOT NULL,
	"generated_assignment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "methodology_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"source_ref" text,
	"embedding" vector(1024),
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"ip_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_txn_id" text NOT NULL,
	"amount_krw" integer NOT NULL,
	"status" "payment_status" NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"value" jsonb,
	"audio_storage_key" text,
	"is_correct" boolean,
	"points_awarded" real,
	"ai_feedback" text,
	"teacher_feedback" text,
	"teacher_overrode" boolean DEFAULT false NOT NULL,
	"time_spent_sec" integer DEFAULT 0 NOT NULL,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"first_answer_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"birth_year" smallint,
	"guardian_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"course_id" text,
	"group_id" text,
	"plan" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"provider" "payment_provider",
	"provider_ref" text,
	"price_krw" integer NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"school_name" text,
	"subjects" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_content_language" text,
	"default_cefr_level" text,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"role" "user_role" NOT NULL,
	"phone" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"full_name" text,
	"ui_locale" "ui_locale" DEFAULT 'uz-Latn' NOT NULL,
	"ui_script" text DEFAULT 'latn' NOT NULL,
	"avatar_url" text,
	"telegram_chat_id" text,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assignment_blocks" ADD CONSTRAINT "assignment_blocks_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_assignment_template_id_assignments_id_fk" FOREIGN KEY ("assignment_template_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_runs" ADD CONSTRAINT "course_runs_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_runs" ADD CONSTRAINT "course_runs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_block_id_assignment_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."assignment_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_source_material_id_materials_id_fk" FOREIGN KEY ("source_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_links" ADD CONSTRAINT "material_links_audio_material_id_materials_id_fk" FOREIGN KEY ("audio_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_links" ADD CONSTRAINT "material_links_source_material_id_materials_id_fk" FOREIGN KEY ("source_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_blocks_assignment_idx" ON "assignment_blocks" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_share_slug_uq" ON "assignments" USING btree ("share_slug");--> statement-breakpoint
CREATE INDEX "assignments_group_idx" ON "assignments" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_assignment_student_uq" ON "attempts" USING btree ("assignment_id","student_id");--> statement-breakpoint
CREATE INDEX "attempts_assignment_status_idx" ON "attempts" USING btree ("assignment_id","status");--> statement-breakpoint
CREATE INDEX "conversations_teacher_idx" ON "conversations" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_group_student_uq" ON "enrollments" USING btree ("group_id","student_id");--> statement-breakpoint
CREATE INDEX "enrollments_group_idx" ON "enrollments" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "exercises_assignment_idx" ON "exercises" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "groups_teacher_idx" ON "groups" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_join_code_uq" ON "groups" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "materials_content_hash_idx" ON "materials" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "materials_teacher_idx" ON "materials" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "otp_phone_created_idx" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "otp_ip_created_idx" ON "otp_codes" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_txn_uq" ON "payments" USING btree ("provider","provider_txn_id");--> statement-breakpoint
CREATE INDEX "responses_attempt_idx" ON "responses" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_attempt_exercise_uq" ON "responses" USING btree ("attempt_id","exercise_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");
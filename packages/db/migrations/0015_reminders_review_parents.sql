CREATE TABLE "notification_log" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"step" smallint DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"last_right" boolean,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_log_created_idx" ON "notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "parent_links_token_uq" ON "parent_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "parent_links_student_idx" ON "parent_links" USING btree ("student_id","teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_student_exercise_uq" ON "review_items" USING btree ("student_id","exercise_id");--> statement-breakpoint
CREATE INDEX "review_items_student_due_idx" ON "review_items" USING btree ("student_id","due_at");--> statement-breakpoint
CREATE INDEX "attempts_student_idx" ON "attempts" USING btree ("student_id");
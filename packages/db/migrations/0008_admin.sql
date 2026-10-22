CREATE TABLE "admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"purpose" text NOT NULL,
	"ref_id" text,
	"task" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"thoughts_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"assignment_id" text,
	"mode" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error_code" text,
	"error_detail" text,
	"duration_ms" integer,
	"items" integer,
	"materials" integer DEFAULT 0 NOT NULL,
	"pictures_pointed" integer DEFAULT 0 NOT NULL,
	"pictures_located" integer DEFAULT 0 NOT NULL,
	"pictures_attached" integer DEFAULT 0 NOT NULL,
	"pictures_removed" integer DEFAULT 0 NOT NULL,
	"review" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"role_id" text NOT NULL,
	"added_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD COLUMN "daily_cap" integer;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD COLUMN "cap_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."staff_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_ref_idx" ON "ai_calls" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "generation_runs_created_idx" ON "generation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_phone_uq" ON "staff_members" USING btree ("phone");
CREATE TABLE "methodology_patterns" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"guidance" text NOT NULL,
	"steps" jsonb NOT NULL,
	"language" text,
	"level" text,
	"age_group" text DEFAULT 'any' NOT NULL,
	"subject" text,
	"book_name" text,
	"topic" text,
	"grammar_points" text[] DEFAULT '{}'::text[] NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "methodology_patterns" ADD CONSTRAINT "methodology_patterns_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "methodology_patterns_status_idx" ON "methodology_patterns" USING btree ("status","language");
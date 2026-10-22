CREATE TABLE "lab_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"methodology_id" text NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"files" text[] DEFAULT '{}'::text[] NOT NULL,
	"proposal" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "methodologies" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"levels" text[] DEFAULT '{}'::text[] NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "methodology_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"methodology_id" text NOT NULL,
	"before" jsonb NOT NULL,
	"note" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_messages" ADD CONSTRAINT "lab_messages_methodology_id_methodologies_id_fk" FOREIGN KEY ("methodology_id") REFERENCES "public"."methodologies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_messages" ADD CONSTRAINT "lab_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_versions" ADD CONSTRAINT "methodology_versions_methodology_id_methodologies_id_fk" FOREIGN KEY ("methodology_id") REFERENCES "public"."methodologies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_versions" ADD CONSTRAINT "methodology_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_messages_m_idx" ON "lab_messages" USING btree ("methodology_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "methodologies_exam_uq" ON "methodologies" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "methodology_versions_m_idx" ON "methodology_versions" USING btree ("methodology_id","created_at");
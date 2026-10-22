CREATE TABLE "lab_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"upload_url" text NOT NULL,
	"granularity" integer NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"buffer" "bytea" NOT NULL,
	"file_name" text,
	"file_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_uploads" ADD CONSTRAINT "lab_uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
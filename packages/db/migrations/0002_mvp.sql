CREATE TABLE "material_blobs" (
	"material_id" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "verify_flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "material_blobs" ADD CONSTRAINT "material_blobs_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
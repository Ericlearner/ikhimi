ALTER TABLE "lab_messages" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "methodologies" ADD COLUMN "tasks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "methodologies" ADD COLUMN "samples" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "methodology_versions" ADD COLUMN "before_blueprint" jsonb;
ALTER TABLE "exercises" ADD COLUMN "audio_label" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "audio_material_id" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_audio_material_id_materials_id_fk" FOREIGN KEY ("audio_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;
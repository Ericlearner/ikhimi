CREATE TABLE "help_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"topic" text NOT NULL,
	"gist" text,
	"handoff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "help_questions" ADD CONSTRAINT "help_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "help_questions_user_idx" ON "help_questions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "help_questions_created_idx" ON "help_questions" USING btree ("created_at");
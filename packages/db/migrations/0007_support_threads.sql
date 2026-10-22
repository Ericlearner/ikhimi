CREATE TABLE "support_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_message_id" integer NOT NULL,
	"user_chat_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "support_threads_admin_msg_uq" ON "support_threads" USING btree ("admin_message_id");
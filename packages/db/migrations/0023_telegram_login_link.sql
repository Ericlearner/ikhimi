ALTER TABLE "telegram_logins" ADD COLUMN "link_hash" text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "as_role" text;--> statement-breakpoint
ALTER TABLE "telegram_logins" ADD COLUMN "next" text;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_logins_link_uq" ON "telegram_logins" USING btree ("link_hash");
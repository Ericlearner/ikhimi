CREATE TABLE "plan_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"plan" text NOT NULL,
	"seats" integer NOT NULL,
	"months" integer NOT NULL,
	"group_id" text,
	"status" "subscription_status" NOT NULL,
	"provider" "payment_provider",
	"price_krw" integer NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "package_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "package_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "months" integer;--> statement-breakpoint
ALTER TABLE "plan_packages" ADD CONSTRAINT "plan_packages_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_packages" ADD CONSTRAINT "plan_packages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_packages_teacher_idx" ON "plan_packages" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "plan_packages_group_idx" ON "plan_packages" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_plan_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."plan_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_package_id_plan_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."plan_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- VIP granted in the admin panel before plans existed becomes a staff-granted VIP plan
INSERT INTO "subscriptions" ("id", "student_id", "plan", "status", "price_krw", "period_start", "period_end")
SELECT gen_random_uuid()::text, "id", 'vip', 'active', 0, now(), "vip_until" FROM "users" WHERE "vip_until" > now();--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "vip_until";
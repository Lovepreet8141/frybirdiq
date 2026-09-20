-- Basic shifts (roadmap 6.4): clock in / clock out, one row per stretch of work.
-- Expand-only: one new empty table, nothing existing is touched. Recovery:
-- supabase/rollback/PENDING_shifts.down.sql. No wages, breaks or overtime.
--
-- Same posture as 0041: RLS on and forced, no client DML for either API role,
-- members may read their own org's rows through a Supabase key. The app writes
-- as `postgres` through Drizzle.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"clock_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_out_at" timestamp with time zone,
	"business_date" date NOT NULL,
	"corrected_by" uuid,
	"corrected_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_order_check" CHECK ("shifts"."clock_out_at" IS NULL OR "shifts"."clock_out_at" > "shifts"."clock_in_at"),
	CONSTRAINT "shifts_note_check" CHECK ("shifts"."note" IS NULL OR char_length("shifts"."note") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_per_person_idx" ON "shifts" USING btree ("org_id","user_id") WHERE "shifts"."clock_out_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shifts_org_date_idx" ON "shifts" USING btree ("org_id","business_date");--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "shifts" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE POLICY shifts_tenant_read ON "shifts" FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));--> statement-breakpoint
GRANT SELECT ON TABLE "shifts" TO authenticated;

-- Shift breaks (roadmap 6.4, owner change): break start/end as time entries
-- inside a shift. Times only: no pay logic of any kind. Expand-only, one new
-- empty table; needs PENDING_shifts (the shifts table) numbered before it.
-- Same posture as 0041: RLS on and forced, no client DML for either API role,
-- members may read their own org's rows through a Supabase key.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "shift_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"corrected_by" uuid,
	"corrected_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_breaks_order_check" CHECK ("shift_breaks"."ended_at" IS NULL OR "shift_breaks"."ended_at" > "shift_breaks"."started_at"),
	CONSTRAINT "shift_breaks_note_check" CHECK ("shift_breaks"."note" IS NULL OR char_length("shift_breaks"."note") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "shift_breaks" ADD CONSTRAINT "shift_breaks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_breaks" ADD CONSTRAINT "shift_breaks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_breaks_one_open_idx" ON "shift_breaks" USING btree ("shift_id") WHERE "shift_breaks"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shift_breaks_org_shift_idx" ON "shift_breaks" USING btree ("org_id","shift_id");--> statement-breakpoint
ALTER TABLE "shift_breaks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_breaks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "shift_breaks" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE POLICY shift_breaks_tenant_read ON "shift_breaks" FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));--> statement-breakpoint
GRANT SELECT ON TABLE "shift_breaks" TO authenticated;

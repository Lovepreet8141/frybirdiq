-- Kitchen stations (roadmap 4.2). Additive only: one new table.
--
-- Which station a line belongs to is NOT stored here: it is read live from
-- products.kds_station (already in the schema, edited on the product form).
-- This table records only that a station finished a line. `station` is the
-- station the line resolved to when it was marked, kept as history.
CREATE TABLE "kitchen_line_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"station" text NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_line_status_station_check" CHECK ("kitchen_line_status"."station" IN ('FRY', 'ASSEMBLY', 'DRINKS', 'PACK', 'UNASSIGNED'))
);
--> statement-breakpoint
ALTER TABLE "kitchen_line_status" ADD CONSTRAINT "kitchen_line_status_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_line_status" ADD CONSTRAINT "kitchen_line_status_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_line_status" ADD CONSTRAINT "kitchen_line_status_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_line_status_item_idx" ON "kitchen_line_status" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "kitchen_line_status_org_order_idx" ON "kitchen_line_status" USING btree ("org_id","order_id");--> statement-breakpoint
-- Same posture as 0041: RLS on and forced, no client DML for either API role,
-- members may read their own org's rows through a Supabase key. The app writes
-- as `postgres` through Drizzle.
ALTER TABLE "kitchen_line_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kitchen_line_status" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "kitchen_line_status" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE POLICY kitchen_line_status_tenant_read ON "kitchen_line_status" FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));--> statement-breakpoint
GRANT SELECT ON TABLE "kitchen_line_status" TO authenticated;

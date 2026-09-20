-- PACK step (roadmap 4.2, owner change). Additive only: one new table.
--
-- PACK is the last step of a TAKEAWAY or DELIVERY order, done once for the whole
-- order after every line is done. One row per order; presence means packed,
-- deleting the row is "undo". Requires 0047_kitchen_stations only in spirit (no FK
-- to it): this table stands alone on orders.
CREATE TABLE "kitchen_order_pack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"packed_by" uuid,
	"packed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kitchen_order_pack" ADD CONSTRAINT "kitchen_order_pack_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_order_pack" ADD CONSTRAINT "kitchen_order_pack_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_order_pack_order_idx" ON "kitchen_order_pack" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "kitchen_order_pack_org_idx" ON "kitchen_order_pack" USING btree ("org_id");--> statement-breakpoint
-- Same posture as 0041 and 0047_kitchen_stations: RLS on and forced, no client DML,
-- members may read their own org's rows through a Supabase key.
ALTER TABLE "kitchen_order_pack" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kitchen_order_pack" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "kitchen_order_pack" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE POLICY kitchen_order_pack_tenant_read ON "kitchen_order_pack" FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));--> statement-breakpoint
GRANT SELECT ON TABLE "kitchen_order_pack" TO authenticated;

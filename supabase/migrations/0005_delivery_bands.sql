CREATE TABLE "delivery_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"up_to_metres" integer NOT NULL,
	"flat_fee" bigint DEFAULT 0 NOT NULL,
	"per_km_fee" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_bands_location_upto_unique" UNIQUE("location_id","up_to_metres")
);
--> statement-breakpoint
ALTER TABLE "delivery_bands" ADD CONSTRAINT "delivery_bands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_bands" ADD CONSTRAINT "delivery_bands_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_bands_location_idx" ON "delivery_bands" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "delivery_base_fee";--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "delivery_included_metres";--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "delivery_per_km_fee";--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "delivery_max_metres";--> statement-breakpoint
-- Row-level security. The 0001 migration enumerated its tables explicitly, so
-- a table added later does not inherit a policy — it would simply have RLS off
-- and be readable by any anon key. The enumeration is the audit surface, and
-- this is the cost of that: every new org-scoped table adds its policy here.
ALTER TABLE "delivery_bands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_bands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "delivery_bands_tenant_isolation" ON "delivery_bands"
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

CREATE TABLE "order_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_ratings_order_unique" UNIQUE("order_id"),
	CONSTRAINT "order_ratings_score_range" CHECK ("order_ratings"."score" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "order_ratings" ADD CONSTRAINT "order_ratings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_ratings" ADD CONSTRAINT "order_ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_ratings_org_idx" ON "order_ratings" USING btree ("org_id","score");--> statement-breakpoint

-- Same tenant policy as every other org-scoped table. See 0001.
ALTER TABLE "order_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_ratings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY order_ratings_tenant_isolation ON order_ratings
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

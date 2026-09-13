CREATE TABLE "receipt_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"active" jsonb,
	"previous" jsonb,
	"draft_updated_at" timestamp with time zone,
	"draft_updated_by" uuid,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_designs_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "receipt_designs" ADD CONSTRAINT "receipt_designs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Same tenant policy as every other org-scoped table. See 0001.
ALTER TABLE "receipt_designs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipt_designs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receipt_designs_tenant_isolation ON receipt_designs
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

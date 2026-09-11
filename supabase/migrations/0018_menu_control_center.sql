CREATE TABLE "category_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"channel" text,
	"status" "product_availability_status" DEFAULT 'AVAILABLE' NOT NULL,
	"unavailable_until" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_availability_unique" UNIQUE("category_id","channel")
);
--> statement-breakpoint
CREATE TABLE "menu_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_name" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "serving_info" text;--> statement-breakpoint
ALTER TABLE "category_availability" ADD CONSTRAINT "category_availability_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_availability" ADD CONSTRAINT "category_availability_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_audit_log" ADD CONSTRAINT "menu_audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_availability_category_idx" ON "category_availability" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "menu_audit_log_org_idx" ON "menu_audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "menu_audit_log_entity_idx" ON "menu_audit_log" USING btree ("entity_type","entity_id");
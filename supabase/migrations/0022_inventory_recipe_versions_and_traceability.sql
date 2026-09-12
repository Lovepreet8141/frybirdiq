ALTER TYPE "public"."waste_reason" ADD VALUE 'CANCELLED_ORDER';--> statement-breakpoint
CREATE TABLE "recipe_version_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "recipe_version_items_unique" UNIQUE("version_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"yield_quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_versions_recipe_version_unique" UNIQUE("recipe_id","version")
);
--> statement-breakpoint
ALTER TABLE "ingredient_prices" ADD COLUMN "cost_per_base_unit_milli" bigint;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "order_item_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "recipe_version_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "reversal_of_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "waste_entries" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_version_items" ADD CONSTRAINT "recipe_version_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_version_items" ADD CONSTRAINT "recipe_version_items_version_id_recipe_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_version_items" ADD CONSTRAINT "recipe_version_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_version_items_ingredient_idx" ON "recipe_version_items" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "recipe_versions_recipe_idx" ON "recipe_versions" USING btree ("recipe_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_recipe_version_id_recipe_versions_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversal_of_movement_id_inventory_movements_id_fk" FOREIGN KEY ("reversal_of_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_current_version_id_recipe_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."recipe_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_sale_line_unique" ON "inventory_movements" USING btree ("order_item_id","ingredient_id") WHERE "inventory_movements"."type" = 'SALE';--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_purchase_order_category_unique" UNIQUE("purchase_order_id","category_id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" IN ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'));
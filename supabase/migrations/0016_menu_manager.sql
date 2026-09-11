-- FRYBIRD IQ Menu Manager: draft/publish status for categories, products and
-- modifier groups; product/counter fields (sku, prep time, KDS station); a
-- redesigned product_availability that adds a channel dimension and a real
-- status model instead of a bare boolean; and a media library table.
--
-- Written by hand: product_availability's isAvailable/priceOverride ->
-- channel/status/unavailableUntil/reason is a semantic redesign, not a
-- rename, and drizzle-kit's interactive rename-or-recreate prompt has no TTY
-- to answer in this session. The table has zero real rows today (grepped:
-- nothing in the codebase writes to it yet), so this is schema-only, no
-- backfill needed.

CREATE TYPE "public"."menu_item_status" AS ENUM('DRAFT', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."product_availability_status" AS ENUM('AVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'SOLD_OUT_TODAY', 'SCHEDULED_UNAVAILABLE');--> statement-breakpoint

-- categories, products, modifier_groups: draft/publish. Defaults PUBLISHED so
-- nothing already live disappears from getMenu() the moment this deploys.
ALTER TABLE "categories" ADD COLUMN "status" "menu_item_status" DEFAULT 'PUBLISHED' NOT NULL;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD COLUMN "status" "menu_item_status" DEFAULT 'PUBLISHED' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "prep_minutes" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kds_station" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" "menu_item_status" DEFAULT 'PUBLISHED' NOT NULL;--> statement-breakpoint

-- product_availability: location_id becomes optional (null = every
-- location), a channel dimension is added (null = every channel, loose text
-- matching product_channel_prices.channel rather than the closed
-- OrderChannel enum), and the boolean is_available/price_override pair is
-- replaced by a real status plus a scheduled-return timestamp and a reason.
ALTER TABLE "product_availability" DROP CONSTRAINT "product_availability_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "product_availability" DROP CONSTRAINT "product_availability_unique";--> statement-breakpoint
ALTER TABLE "product_availability" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_availability" ADD CONSTRAINT "product_availability_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_availability" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "product_availability" ADD COLUMN "status" "product_availability_status" DEFAULT 'AVAILABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_availability" ADD COLUMN "unavailable_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_availability" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "product_availability" DROP COLUMN "is_available";--> statement-breakpoint
ALTER TABLE "product_availability" DROP COLUMN "price_override";--> statement-breakpoint
ALTER TABLE "product_availability" ADD CONSTRAINT "product_availability_unique" UNIQUE("product_id","location_id","channel");--> statement-breakpoint
CREATE INDEX "product_availability_product_idx" ON "product_availability" USING btree ("product_id");--> statement-breakpoint

-- media: the library every image picker (product, category banner) reads
-- from and writes into once, rather than each uploading its own copy.
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_org_idx" ON "media" USING btree ("org_id");

ALTER TABLE "locations" ADD COLUMN "lat_micro" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "lng_micro" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "delivery_base_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "delivery_included_metres" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "delivery_per_km_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "delivery_max_metres" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "delivery_free_above" bigint;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "delivery_road_factor_bps" integer DEFAULT 13000 NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "lat_micro" integer;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "lng_micro" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_lat_micro" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_lng_micro" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_distance_metres" integer;
CREATE TYPE "public"."product_type" AS ENUM('SIMPLE', 'COMBO');--> statement-breakpoint
DROP TABLE "product_channel_prices" CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_type" "product_type" DEFAULT 'SIMPLE' NOT NULL;
ALTER TABLE "promotions" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "type" text DEFAULT 'coupon' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "buy_qty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "buy_products" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "get_qty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "get_products" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "get_discount_bps" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "products" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "combo_price" bigint;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "start_time" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "end_time" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "days_mask" integer DEFAULT 127 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "customer_segment" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "stacking" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "channel_pos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "channel_web" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "per_customer_limit" integer;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "live_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_type_check" CHECK ("promotions"."type" IN ('percent','flat','coupon','bogo','bxgy','combo','freeitem','happyhour'));--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_status_check" CHECK ("promotions"."status" IN ('draft','live','paused'));--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_segment_check" CHECK ("promotions"."customer_segment" IN ('everyone','new','returning','members'));--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_stacking_check" CHECK ("promotions"."stacking" IN ('none','allow'));--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_days_mask_check" CHECK ("promotions"."days_mask" BETWEEN 0 AND 127);--> statement-breakpoint
-- Backfill: every promotion that existed before this migration was a website
-- coupon (the only kind the shop could have). Live ones stay live on the
-- website; switched-off ones become paused. Nothing is pushed to the POS.
UPDATE "promotions"
SET "type" = 'coupon',
    "status" = CASE WHEN "is_active" THEN 'live' ELSE 'paused' END,
    "channel_web" = "is_active",
    "live_since" = CASE WHEN "is_active" THEN "created_at" ELSE NULL END;

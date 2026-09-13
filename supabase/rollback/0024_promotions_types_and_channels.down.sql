-- Hand-run only. Reverses 0024: drops the product-aware promotion columns and
-- constraints and restores NOT NULL on code. Any non-coupon promotion created
-- after 0024 has no code and must be deleted first, or the NOT NULL fails.
ALTER TABLE "promotions" DROP CONSTRAINT IF EXISTS "promotions_days_mask_check";
ALTER TABLE "promotions" DROP CONSTRAINT IF EXISTS "promotions_stacking_check";
ALTER TABLE "promotions" DROP CONSTRAINT IF EXISTS "promotions_segment_check";
ALTER TABLE "promotions" DROP CONSTRAINT IF EXISTS "promotions_status_check";
ALTER TABLE "promotions" DROP CONSTRAINT IF EXISTS "promotions_type_check";
ALTER TABLE "promotions"
  DROP COLUMN IF EXISTS "live_since", DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "per_customer_limit",
  DROP COLUMN IF EXISTS "channel_web", DROP COLUMN IF EXISTS "channel_pos", DROP COLUMN IF EXISTS "stacking",
  DROP COLUMN IF EXISTS "customer_segment", DROP COLUMN IF EXISTS "days_mask", DROP COLUMN IF EXISTS "end_time",
  DROP COLUMN IF EXISTS "start_time", DROP COLUMN IF EXISTS "combo_price", DROP COLUMN IF EXISTS "products",
  DROP COLUMN IF EXISTS "get_discount_bps", DROP COLUMN IF EXISTS "get_products", DROP COLUMN IF EXISTS "get_qty",
  DROP COLUMN IF EXISTS "buy_products", DROP COLUMN IF EXISTS "buy_qty", DROP COLUMN IF EXISTS "type";
ALTER TABLE "promotions" ALTER COLUMN "code" SET NOT NULL;

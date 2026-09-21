-- Client-facing privilege hardening (the held-back security lows: pin-anon-grant, pin-hash-column, orders-column-limits).
-- PRIVILEGE CHANGE, no data touched, no table rewritten. The app reads and writes through Drizzle as `postgres`, which these grants do not affect;
-- they govern only the PostgREST / Realtime door (anon and authenticated keys). Nothing in the app reads `orders` or `memberships` through that door
-- (Realtime subscribes to order_events, products and product_availability only).
--   1. anon loses SELECT on memberships (it kept a table-level SELECT incl. pos_pin_hash; harmless while no anon policy exists, now closed).
--   2. anon loses SELECT on orders (no anon policy exists either).
--   3. authenticated keeps SELECT on orders EXCEPT the customer contact columns: customer_name, customer_phone, delivery_address,
--      delivery_lat_micro, delivery_lng_micro, notes. Row policies cannot limit columns; a KITCHEN, RIDER or ANALYST login could read them
--      through PostgREST. Same mechanism as memberships in 0042; a test forces a decision for every new orders column.
-- Undo: supabase/rollback/0055_client_grant_hardening.down.sql restores the grants exactly (verified against production, read-only, 22 Sep 2026).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
REVOKE SELECT ON public.memberships FROM anon;
--> statement-breakpoint
REVOKE SELECT ON public.orders FROM anon;
--> statement-breakpoint
REVOKE SELECT ON public.orders FROM authenticated;
--> statement-breakpoint
GRANT SELECT (id, org_id, location_id, order_number, status, channel, fulfilment, customer_id, table_label, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total, tax_total, delivery_fee, packaging_fee, tip_amount, grand_total, promotion_code, placed_at, accepted_at, ready_at, completed_at, scheduled_for, created_at, updated_at, delivery_distance_metres, points_redeemed, points_earned, invoice_number, invoiced_at, cancellation_reason, estimated_ready_at, business_date, stamp_reward_discount, stamp_reward_id, stamp_reward_product_slug, table_id, rider_id, rider_assigned_at) ON public.orders TO authenticated;

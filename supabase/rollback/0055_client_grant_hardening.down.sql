-- Hand-run only. Reverses 0055 (client grant hardening): puts back the table-level SELECT that production had. No data is touched; one transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE SELECT (id, org_id, location_id, order_number, status, channel, fulfilment, customer_id, table_label, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total, tax_total, delivery_fee, packaging_fee, tip_amount, grand_total, promotion_code, placed_at, accepted_at, ready_at, completed_at, scheduled_for, created_at, updated_at, delivery_distance_metres, points_redeemed, points_earned, invoice_number, invoiced_at, cancellation_reason, estimated_ready_at, business_date, stamp_reward_discount, stamp_reward_id, stamp_reward_product_slug, table_id, rider_id, rider_assigned_at) ON public.orders FROM authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.orders TO anon;
GRANT SELECT ON public.memberships TO anon;
COMMIT;

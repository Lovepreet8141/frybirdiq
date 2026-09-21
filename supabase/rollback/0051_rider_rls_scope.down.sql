-- Hand-run only. Reverses 0051 (rider-rls-scope): drops its six restrictive policies and the helper function. No data is touched; one transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS orders_rider_scope ON orders;
DROP POLICY IF EXISTS order_items_rider_scope ON order_items;
DROP POLICY IF EXISTS order_events_rider_scope ON order_events;
DROP POLICY IF EXISTS kitchen_line_status_rider_scope ON kitchen_line_status;
DROP POLICY IF EXISTS kitchen_order_pack_rider_scope ON kitchen_order_pack;
DROP POLICY IF EXISTS order_item_modifiers_rider_scope ON order_item_modifiers;
DROP FUNCTION IF EXISTS auth_is_rider_scoped(uuid);
COMMIT;

-- Hand-run only. Reverses 0047: drops its restrictive read policies. No data is touched. One transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS notification_outbox_role_read ON notification_outbox;
DROP POLICY IF EXISTS kitchen_line_status_role_read ON kitchen_line_status;
DROP POLICY IF EXISTS kitchen_order_pack_role_read ON kitchen_order_pack;
DROP POLICY IF EXISTS shifts_role_read ON shifts;
DROP POLICY IF EXISTS shift_breaks_role_read ON shift_breaks;
COMMIT;

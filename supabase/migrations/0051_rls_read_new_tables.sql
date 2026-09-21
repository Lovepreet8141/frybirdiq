-- p0-7 follow-on: role-aware READ limits for the tables added after 0042
-- (notification_outbox holds customers phone numbers; kitchen_line_status and kitchen_order_pack).
-- Same mechanism as 0042: additive RESTRICTIVE SELECT policies, generated from
-- src/domain/rls-read-limits.ts, undo = drop the policies
-- (supabase/rollback/0051_rls_read_new_tables.down.sql). shifts and shift_breaks are limited to the person's own rows unless
-- the login holds staff.manage (OWN_ROW_LIMITS_0047).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE POLICY notification_outbox_role_read ON notification_outbox
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']));
--> statement-breakpoint
CREATE POLICY kitchen_line_status_role_read ON kitchen_line_status
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY kitchen_order_pack_role_read ON kitchen_order_pack
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY shifts_role_read ON shifts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN']) OR user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY shift_breaks_role_read ON shift_breaks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN']) OR EXISTS (SELECT 1 FROM shifts s WHERE s.id = shift_breaks.shift_id AND s.user_id = auth.uid()));

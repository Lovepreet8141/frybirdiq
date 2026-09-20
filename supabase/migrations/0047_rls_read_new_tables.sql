-- p0-7 follow-on: role-aware READ limits for the tables added after 0042
-- (notification_outbox holds customers' phone numbers; kitchen_line_status).
-- Same mechanism as 0042: additive RESTRICTIVE SELECT policies, generated from
-- src/domain/rls-read-limits.ts, undo = drop the policies
-- (supabase/rollback/0047_rls_read_new_tables.down.sql). shifts is open to
-- members on purpose (see OPEN_TO_MEMBERS_ON_PURPOSE).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE POLICY notification_outbox_role_read ON notification_outbox
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']));
--> statement-breakpoint
CREATE POLICY kitchen_line_status_role_read ON kitchen_line_status
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'ANALYST']));

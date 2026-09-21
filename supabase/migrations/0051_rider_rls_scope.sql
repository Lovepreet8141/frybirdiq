-- rider-rls-scope (owner-approved 2026-09-21): a rider-only login reads only the deliveries
-- assigned to it at the DATABASE level. Migration 0042 let a RIDER read every order in the
-- org (customer names, phones, addresses) through PostgREST or Realtime with its own token.
-- This adds a helper function (auth_is_rider_scoped) and RESTRICTIVE SELECT policies on
-- orders, order_items, order_item_modifiers, order_events, kitchen_line_status and
-- kitchen_order_pack: a rider-only user passes only where orders.rider_id = auth.uid().
-- Everyone else (owner, admin, manager, cashier, kitchen, analyst, and a person who is a
-- rider AND works the counter) is unchanged: the policy is `NOT rider_scoped OR ...`.
-- The app itself reads through Drizzle as `postgres`, which bypasses RLS: no page or action changes.
--
-- Additive: one function and six restrictive policies, generated from
-- src/domain/rls-read-limits.ts (scripts/gen-rls-read-policies.ts 0051) and drift-tested.
-- Undo (supabase/rollback/0051_rider_rls_scope.down.sql) drops them; no data is touched.
-- Recovery: docs/MIGRATION-RECOVERY.md 4k.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth_is_rider_scoped(target_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = auth.uid() AND org_id = target_org AND is_active AND role = 'RIDER'
  )
  AND NOT auth_has_role(target_org, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'ANALYST'])
$$;
--> statement-breakpoint
CREATE POLICY orders_rider_scope ON orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT auth_is_rider_scoped(org_id) OR rider_id = auth.uid());
--> statement-breakpoint
CREATE POLICY order_items_rider_scope ON order_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT auth_is_rider_scoped(org_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.rider_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY order_events_rider_scope ON order_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT auth_is_rider_scoped(org_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_events.order_id AND o.rider_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY kitchen_line_status_rider_scope ON kitchen_line_status
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT auth_is_rider_scoped(org_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.id = kitchen_line_status.order_id AND o.rider_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY kitchen_order_pack_rider_scope ON kitchen_order_pack
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT auth_is_rider_scoped(org_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.id = kitchen_order_pack.order_id AND o.rider_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY order_item_modifiers_rider_scope ON order_item_modifiers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT auth_is_rider_scoped(org_id) OR EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = order_item_modifiers.order_item_id AND o.rider_id = auth.uid()));

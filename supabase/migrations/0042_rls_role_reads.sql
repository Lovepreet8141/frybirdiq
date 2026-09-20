-- p0-7 (2): role-aware READ limits for staff logins that talk to the database
-- directly (PostgREST / Realtime with the public anon key). Migration 0001 gave
-- every tenant table a policy that checks org membership and never the role, so
-- any active login (CASHIER, KITCHEN, RIDER, ...) could read customers,
-- payments, refunds, the books, and every member's PIN hash. The app itself
-- reads through Drizzle as `postgres`, which bypasses RLS: pages and actions
-- are unaffected.
--
-- Additive: this only ADDS restrictive SELECT policies (40). A restrictive
-- policy is ANDed with the existing permissive ones, so no existing policy,
-- grant or row changes; undo = drop the policies
-- (supabase/rollback/0042_rls_role_reads.down.sql), no data involved. The role
-- lists are generated from src/domain/permissions.ts (scripts/
-- gen-rls-read-policies.ts) and a test fails if they ever drift. Menu tables
-- (products, product_availability, ...) are untouched: Realtime reads them.
--
-- Recovery: docs/MIGRATION-RECOVERY.md 4i.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE POLICY accounts_role_read ON accounts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY expenses_role_read ON expenses
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY expense_categories_role_read ON expense_categories
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY recurring_expenses_role_read ON recurring_expenses
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY targets_role_read ON targets
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY payments_role_read ON payments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY refunds_role_read ON refunds
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY cash_sessions_role_read ON cash_sessions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY cash_handovers_role_read ON cash_handovers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'MANAGER']));
--> statement-breakpoint
CREATE POLICY customers_role_read ON customers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']));
--> statement-breakpoint
CREATE POLICY addresses_role_read ON addresses
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']));
--> statement-breakpoint
CREATE POLICY loyalty_accounts_role_read ON loyalty_accounts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']));
--> statement-breakpoint
CREATE POLICY loyalty_transactions_role_read ON loyalty_transactions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']));
--> statement-breakpoint
CREATE POLICY loyalty_stamp_events_role_read ON loyalty_stamp_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']));
--> statement-breakpoint
CREATE POLICY orders_role_read ON orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY order_items_role_read ON order_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY order_item_modifiers_role_read ON order_item_modifiers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY order_events_role_read ON order_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'RIDER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY order_ratings_role_read ON order_ratings
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY print_jobs_role_read ON print_jobs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY analytics_events_role_read ON analytics_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY ai_conversations_role_read ON ai_conversations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY purchase_orders_role_read ON purchase_orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY purchase_order_items_role_read ON purchase_order_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY ingredient_prices_role_read ON ingredient_prices
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY inventory_items_role_read ON inventory_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY inventory_movements_role_read ON inventory_movements
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY waste_entries_role_read ON waste_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY recipes_role_read ON recipes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY recipe_items_role_read ON recipe_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY recipe_versions_role_read ON recipe_versions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY recipe_version_items_role_read ON recipe_version_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY menu_audit_log_role_read ON menu_audit_log
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY price_history_role_read ON price_history
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN', 'INVENTORY', 'ANALYST']));
--> statement-breakpoint
CREATE POLICY integrations_role_read ON integrations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN']));
--> statement-breakpoint
CREATE POLICY pos_devices_role_read ON pos_devices
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN']));
--> statement-breakpoint
CREATE POLICY printers_role_read ON printers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN']));
--> statement-breakpoint
CREATE POLICY ai_messages_role_read ON ai_messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM ai_conversations p WHERE p.id = ai_messages.conversation_id AND auth_has_role(p.org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'])));
--> statement-breakpoint
CREATE POLICY ai_tool_calls_role_read ON ai_tool_calls
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM ai_conversations p WHERE p.id = ai_tool_calls.conversation_id AND auth_has_role(p.org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'])));
--> statement-breakpoint
CREATE POLICY memberships_role_read ON memberships
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR auth_has_role(org_id, ARRAY['OWNER', 'ADMIN']));

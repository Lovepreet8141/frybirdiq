-- Hand-run only. Reverses 0042: drops the 40 restrictive read policies. No data is touched; the previous permissive policies were never changed, so they are exactly as before. One transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS accounts_role_read ON accounts;

DROP POLICY IF EXISTS expenses_role_read ON expenses;

DROP POLICY IF EXISTS expense_categories_role_read ON expense_categories;

DROP POLICY IF EXISTS recurring_expenses_role_read ON recurring_expenses;

DROP POLICY IF EXISTS targets_role_read ON targets;

DROP POLICY IF EXISTS payments_role_read ON payments;

DROP POLICY IF EXISTS refunds_role_read ON refunds;

DROP POLICY IF EXISTS cash_sessions_role_read ON cash_sessions;

DROP POLICY IF EXISTS cash_handovers_role_read ON cash_handovers;

DROP POLICY IF EXISTS customers_role_read ON customers;

DROP POLICY IF EXISTS addresses_role_read ON addresses;

DROP POLICY IF EXISTS loyalty_accounts_role_read ON loyalty_accounts;

DROP POLICY IF EXISTS loyalty_transactions_role_read ON loyalty_transactions;

DROP POLICY IF EXISTS loyalty_stamp_events_role_read ON loyalty_stamp_events;

DROP POLICY IF EXISTS orders_role_read ON orders;

DROP POLICY IF EXISTS order_items_role_read ON order_items;

DROP POLICY IF EXISTS order_item_modifiers_role_read ON order_item_modifiers;

DROP POLICY IF EXISTS order_events_role_read ON order_events;

DROP POLICY IF EXISTS order_ratings_role_read ON order_ratings;

DROP POLICY IF EXISTS print_jobs_role_read ON print_jobs;

DROP POLICY IF EXISTS analytics_events_role_read ON analytics_events;

DROP POLICY IF EXISTS ai_conversations_role_read ON ai_conversations;

DROP POLICY IF EXISTS purchase_orders_role_read ON purchase_orders;

DROP POLICY IF EXISTS purchase_order_items_role_read ON purchase_order_items;

DROP POLICY IF EXISTS ingredient_prices_role_read ON ingredient_prices;

DROP POLICY IF EXISTS inventory_items_role_read ON inventory_items;

DROP POLICY IF EXISTS inventory_movements_role_read ON inventory_movements;

DROP POLICY IF EXISTS waste_entries_role_read ON waste_entries;

DROP POLICY IF EXISTS recipes_role_read ON recipes;

DROP POLICY IF EXISTS recipe_items_role_read ON recipe_items;

DROP POLICY IF EXISTS recipe_versions_role_read ON recipe_versions;

DROP POLICY IF EXISTS recipe_version_items_role_read ON recipe_version_items;

DROP POLICY IF EXISTS menu_audit_log_role_read ON menu_audit_log;

DROP POLICY IF EXISTS price_history_role_read ON price_history;

DROP POLICY IF EXISTS integrations_role_read ON integrations;

DROP POLICY IF EXISTS pos_devices_role_read ON pos_devices;

DROP POLICY IF EXISTS printers_role_read ON printers;

DROP POLICY IF EXISTS ai_messages_role_read ON ai_messages;

DROP POLICY IF EXISTS ai_tool_calls_role_read ON ai_tool_calls;

DROP POLICY IF EXISTS memberships_role_read ON memberships;
COMMIT;

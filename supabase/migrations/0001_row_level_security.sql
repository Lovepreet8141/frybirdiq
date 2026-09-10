-- Row-level security. BUILD-PLAN.md §46.
--
-- Authorization happens server-side, and the last line of it is Postgres
-- itself: even a bug in a repository that forgets an org filter cannot return
-- another organization's rows. The service role bypasses all of this by
-- design, which is why `createAdminClient()` is restricted to migrations,
-- seeding and webhook handlers with no user session.

-- The organizations the signed-in user belongs to.
-- SECURITY DEFINER so the policy can read `memberships` without recursing
-- into the policy on `memberships` itself.
CREATE OR REPLACE FUNCTION auth_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM memberships
  WHERE user_id = auth.uid()
    AND is_active
$$;

-- Whether the user holds a role in the organization.
CREATE OR REPLACE FUNCTION auth_has_role(target_org uuid, roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships
    WHERE user_id = auth.uid()
      AND org_id = target_org
      AND is_active
      AND role::text = ANY(roles)
  )
$$;

-- Every table that carries org_id gets the same tenant policy. Written as a
-- loop rather than 40 copies, so a table added later cannot quietly ship
-- without a policy — the list is the audit surface.
DO $$
DECLARE
  target text;
  org_scoped text[] := ARRAY[
    'locations', 'memberships', 'feature_flags',
    'tax_rates', 'categories', 'products', 'product_availability',
    'product_channel_prices', 'modifier_groups', 'modifiers',
    'customers', 'addresses', 'loyalty_accounts', 'loyalty_transactions', 'promotions',
    'orders', 'order_items', 'order_item_modifiers', 'order_events', 'payments', 'refunds',
    'suppliers', 'ingredients', 'ingredient_prices', 'inventory_items',
    'inventory_movements', 'waste_entries', 'recipes', 'recipe_items',
    'purchase_orders', 'purchase_order_items',
    'audit_logs', 'analytics_events', 'ai_conversations', 'integrations'
  ];
BEGIN
  FOREACH target IN ARRAY org_scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated
         USING (org_id IN (SELECT auth_org_ids()))
         WITH CHECK (org_id IN (SELECT auth_org_ids()))',
      target || '_tenant_isolation', target
    );
  END LOOP;
END $$;

-- organizations is keyed on `id`, not `org_id`, so it needs its own policy.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON organizations
  FOR ALL TO authenticated
  USING (id IN (SELECT auth_org_ids()))
  WITH CHECK (id IN (SELECT auth_org_ids()));

-- Tables reached through a parent rather than carrying org_id themselves.
ALTER TABLE product_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_modifier_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY product_modifier_groups_tenant_isolation ON product_modifier_groups
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.org_id IN (SELECT auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.org_id IN (SELECT auth_org_ids())));

ALTER TABLE combo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_items FORCE ROW LEVEL SECURITY;
CREATE POLICY combo_items_tenant_isolation ON combo_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = combo_product_id AND p.org_id IN (SELECT auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = combo_product_id AND p.org_id IN (SELECT auth_org_ids())));

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_messages_tenant_isolation ON ai_messages
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.org_id IN (SELECT auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.org_id IN (SELECT auth_org_ids())));

ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_tool_calls_tenant_isolation ON ai_tool_calls
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.org_id IN (SELECT auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.org_id IN (SELECT auth_org_ids())));

-- Supplier costs are how much FRYBIRD pays for chicken. A cashier signing in
-- at the counter has no reason to see it, and an ANALYST seat given to an
-- outside accountant should not expose the supplier list either. The tenant
-- policy above is replaced on these two tables by a narrower one.
DROP POLICY ingredients_tenant_isolation ON ingredients;
CREATE POLICY ingredients_cost_visibility ON ingredients
  FOR ALL TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY', 'KITCHEN']))
  WITH CHECK (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY']));

DROP POLICY suppliers_tenant_isolation ON suppliers;
CREATE POLICY suppliers_cost_visibility ON suppliers
  FOR ALL TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY']))
  WITH CHECK (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY']));

-- Refunds move money back out after a sale is closed. Reading them is fine for
-- anyone with order access; writing one needs a manager, matching
-- `orders.refund` in src/domain/permissions.ts. The two must stay in step.
DROP POLICY refunds_tenant_isolation ON refunds;
CREATE POLICY refunds_read ON refunds
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));
CREATE POLICY refunds_write ON refunds
  FOR INSERT TO authenticated
  WITH CHECK (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER']));

-- The audit log is append-only. Nobody edits or deletes their own trail.
DROP POLICY audit_logs_tenant_isolation ON audit_logs;
CREATE POLICY audit_logs_read ON audit_logs
  FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN']));
CREATE POLICY audit_logs_append ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

-- Written and read only by the server with the service role, which bypasses
-- RLS. Enabled with no policy so an anon or authenticated key sees nothing.
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

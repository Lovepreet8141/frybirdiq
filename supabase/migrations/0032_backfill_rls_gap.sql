-- Closes a real gap `0001_row_level_security.sql` warned about in its own
-- comment: "a table added later cannot quietly ship without a policy — the
-- list is the audit surface." Nine tables did exactly that — created in
-- migrations after 0001, never added to its org_scoped array, so RLS was
-- never enabled on them at all:
--
--   category_availability (0018), loyalty_rewards (0015),
--   loyalty_stamp_events (0014), media (0016), menu_audit_log (0018),
--   price_history (0020), recipe_version_items (0022),
--   recipe_versions (0022), tables (0021)
--
-- Inert against this app's own code — Drizzle connects as the `postgres`
-- role, which bypasses RLS entirely (src/lib/repositories/org.ts's own
-- comment), so nothing here changes what the app itself can read or write.
-- The exposure is real anyway: with RLS off, Supabase's default grants
-- give the public anon key and any authenticated key full SELECT / INSERT /
-- UPDATE / DELETE on these tables via PostgREST/supabase-js, entirely
-- outside this app's code. `auth_org_ids()` already exists from 0001.
--
-- Seven of the nine get the same generic tenant-isolation shape every other
-- org-scoped table already has — none of them carry the specific
-- supplier-cost sensitivity that gave `ingredients`/`suppliers` their own
-- narrower policy (`recipe_versions`/`recipe_version_items` carry
-- ingredient quantities, not cost figures — the cost lives in `ingredients`,
-- already restricted there), and none carry a customer-privacy angle
-- distinct from `customers`/`loyalty_accounts`, already in the plain array.
DO $$
DECLARE
  target text;
  org_scoped text[] := ARRAY[
    'category_availability', 'loyalty_rewards', 'loyalty_stamp_events',
    'media', 'recipe_version_items', 'recipe_versions', 'tables'
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

-- The other two are append-only in every code path that writes them
-- (`src/lib/repositories/menu-admin.ts`'s `auditCreate`/`auditUpdate`/
-- `auditDelete` for menu_audit_log, `recordIngredientPriceInTx`/
-- `updateProductPrice` for price_history — neither is ever UPDATEd or
-- DELETEd) — the same fact 0001 already gave `audit_logs` its own
-- read/write split for ("The audit log is append-only. Nobody edits or
-- deletes their own trail."). menu_audit_log especially is a named audit
-- trail: granting FOR ALL here would let any authenticated org member
-- silently edit or delete the record of a price change or menu edit
-- through a direct Supabase key, which is exactly the tampering an audit
-- log exists to make visible. Read stays open to any org member — the app
-- itself gates viewing behind `menu.publish`/`menu.view`-shaped
-- permissions, not an OWNER/ADMIN-only check the way general `audit_logs`
-- is, so a read restriction narrower than "any org member" would be
-- stricter than the app's own model.
ALTER TABLE menu_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY menu_audit_log_read ON menu_audit_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));
CREATE POLICY menu_audit_log_append ON menu_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history FORCE ROW LEVEL SECURITY;
CREATE POLICY price_history_read ON price_history
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));
CREATE POLICY price_history_append ON price_history
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

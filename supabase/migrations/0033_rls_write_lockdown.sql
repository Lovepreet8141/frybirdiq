-- Write lockdown for the anon and authenticated roles.
--
-- The gap: 0001 (and 0011/0032 after it) gave ~40 tenant tables a
-- `FOR ALL TO authenticated USING/WITH CHECK (org_id IN auth_org_ids())`
-- policy — membership is checked, role never is — and no migration ever
-- touched GRANTs, so Supabase's default `arwdDxtm` grants to anon and
-- authenticated stayed on every public table. Any active staff member
-- (CASHIER, KITCHEN, RIDER) could therefore sign in and, through PostgREST /
-- supabase-js with the public anon key, insert a `memberships` row with role
-- OWNER for themselves, promote their own row, deactivate the real owner,
-- flip `feature_flags`, edit `organizations`, and write orders, payments
-- and products directly — entirely outside src/domain/permissions.ts.
-- getStaff() (src/lib/auth/index.ts) unions permissions across every active
-- membership row, so a self-inserted OWNER row is a full privilege escalation.
--
-- Why a blanket revoke is safe: the app never writes these tables through a
-- Supabase client. Every write goes through Drizzle as `postgres`, which owns
-- the tables and bypasses RLS and these grants. The supabase-js usage in src/
-- is: `supabase.auth.*` (sign-in/out, sign-up, getUser, admin invite);
-- Storage on the `media` bucket via the service-role client (service_role is
-- not touched here, and neither is the storage schema); and Realtime reads —
-- `postgres_changes` on order_events (INSERT), products and
-- product_availability, which need only SELECT grants plus the existing
-- SELECT-capable policies, both kept — and the customer `order:<id>`
-- broadcast, which the SECURITY DEFINER trigger from 0027 sends (fired by
-- Drizzle's own inserts). No `.rpc(` calls and no client-side `.from(table)`
-- writes exist, so no table is excluded from the revoke.
--
-- Additive-safe: no data changes. SELECT grants and every existing policy
-- that permits SELECT stay exactly as they are. auth and storage schemas are
-- untouched. Reversed by supabase/rollback/0033_rls_write_lockdown.down.sql.

-- 1. The three tables that decide who is in charge: replace FOR ALL with a
--    SELECT-only policy on the same org predicate. Belt and braces with the
--    revoke below — if a later migration ever re-grants writes on the whole
--    schema, these three still refuse every client-side write via RLS.
DROP POLICY memberships_tenant_isolation ON memberships;
--> statement-breakpoint
CREATE POLICY memberships_tenant_read ON memberships
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));
--> statement-breakpoint
DROP POLICY feature_flags_tenant_isolation ON feature_flags;
--> statement-breakpoint
CREATE POLICY feature_flags_tenant_read ON feature_flags
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));
--> statement-breakpoint
DROP POLICY organizations_tenant_isolation ON organizations;
--> statement-breakpoint
CREATE POLICY organizations_tenant_read ON organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT auth_org_ids()));
--> statement-breakpoint

-- 2. No client-side DML on any public table, for either API role. With the
--    privilege gone, PostgREST answers 42501 before RLS is even consulted,
--    so the remaining FOR ALL / INSERT policies become read-only in effect.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
--> statement-breakpoint

-- 3. Tables created later must not quietly regain those grants. Every public
--    table in this stack is created by `postgres` (Drizzle and the Supabase
--    CLI both run migrations as postgres), whose default ACL in `public`
--    grants arwdDxtm to anon and authenticated. `supabase_admin` carries the
--    same default ACL but creates no tables here, and postgres cannot alter
--    another role's defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon, authenticated;

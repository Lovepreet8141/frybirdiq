-- Hand-run only. Reverses 0033: restores the FOR ALL tenant policies on
-- memberships, feature_flags and organizations exactly as 0001 created them,
-- and re-grants INSERT/UPDATE/DELETE/TRUNCATE to anon and authenticated on
-- every public table plus postgres's default privileges in public.
--
-- WARNING: this reopens the privilege escalation 0033 closed — any active
-- staff member can again make themselves OWNER through PostgREST. The
-- re-grant covers ALL tables present when it runs, including any created
-- after 0033 (which, before this rollback, had no client write grants).
-- After running this, delete the 0033 row from drizzle.__drizzle_migrations
-- (or supabase_migrations.schema_migrations on a CLI-managed stack).

DROP POLICY IF EXISTS memberships_tenant_read ON memberships;
CREATE POLICY memberships_tenant_isolation ON memberships
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

DROP POLICY IF EXISTS feature_flags_tenant_read ON feature_flags;
CREATE POLICY feature_flags_tenant_isolation ON feature_flags
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));

DROP POLICY IF EXISTS organizations_tenant_read ON organizations;
CREATE POLICY organizations_tenant_isolation ON organizations
  FOR ALL TO authenticated
  USING (id IN (SELECT auth_org_ids()))
  WITH CHECK (id IN (SELECT auth_org_ids()));

GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon, authenticated;

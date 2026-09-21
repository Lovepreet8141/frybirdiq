import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES } from "./permissions";
import { ORDER_READER_PERMISSIONS, CHILD_READ_LIMITS, generateRiderScopeStatements, riderScopePolicies, MEMBERSHIPS_READ, READ_LIMITS, READ_LIMITS_0047, generateReadLimitStatements, generateReadLimitStatements0047, policies0047, readLimitPolicies, rolesHoldingAny } from "./rls-read-limits";

const migration = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0042_rls_role_reads.sql"), "utf8");
const migration0047 = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0051_rls_read_new_tables.sql"), "utf8");
const undo0047 = readFileSync(path.resolve(__dirname, "../../supabase/rollback/0051_rls_read_new_tables.down.sql"), "utf8");
const migration0052 = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0052_rider_rls_scope.sql"), "utf8");
const undo0052 = readFileSync(path.resolve(__dirname, "../../supabase/rollback/0052_rider_rls_scope.down.sql"), "utf8");
const undo = readFileSync(path.resolve(__dirname, "../../supabase/rollback/0042_rls_role_reads.down.sql"), "utf8");

describe("rls read limits", () => {
  it("migration 0042 is exactly what the permissions table generates (a permission change cannot leave a stale policy)", () => {
    const body = migration.split("--> statement-breakpoint").slice(1).map((s) => s.trim());
    expect(body).toEqual(generateReadLimitStatements().map((s) => s.trim()));
  });

  it("the undo script drops exactly the policies the migration creates", () => {
    const dropped = [...undo.matchAll(/DROP POLICY IF EXISTS (\w+) ON (\w+);/g)].map((m) => `${m[2]}.${m[1]}`).sort();
    expect(dropped).toEqual(readLimitPolicies().map((p) => `${p.table}.${p.policy}`).sort());
  });

  it("only real permissions are named", () => {
    const named = [...Object.values(READ_LIMITS).flat(), ...Object.values(CHILD_READ_LIMITS).flatMap((c) => c.permissions), ...MEMBERSHIPS_READ];
    expect(named.filter((p) => !(PERMISSIONS as readonly string[]).includes(p))).toEqual([]);
  });

  it("the OWNER can read every restricted table (no policy can lock the owner out)", () => {
    for (const permissions of [...Object.values(READ_LIMITS), ...Object.values(CHILD_READ_LIMITS).map((c) => c.permissions), MEMBERSHIPS_READ]) {
      expect(rolesHoldingAny(permissions)).toContain("OWNER");
    }
  });

  it("every role list is non-empty, in role order, and a real role", () => {
    for (const permissions of Object.values(READ_LIMITS)) {
      const roles = rolesHoldingAny(permissions);
      expect(roles.length).toBeGreaterThan(0);
      expect(roles).toEqual(ROLES.filter((r) => roles.includes(r)));
    }
  });

  it("migration 0051 is exactly what the permissions table generates, and its undo drops exactly its policies", () => {
    const body = migration0047.split("--> statement-breakpoint").slice(2).map((x) => x.trim());
    expect([...migration0047.split("--> statement-breakpoint").slice(1)].map((x) => x.trim())).toEqual(generateReadLimitStatements0047().map((x) => x.trim()));
    void body;
    const dropped = [...undo0047.matchAll(/DROP POLICY IF EXISTS (\w+) ON (\w+);/g)].map((m) => `${m[2]}.${m[1]}`).sort();
    expect(dropped).toEqual(policies0047().map((p) => `${p.table}.${p.policy}`).sort());
  });

  it("the 0047 tables name real permissions and never lock the OWNER out", () => {
    for (const permissions of Object.values(READ_LIMITS_0047)) {
      expect(permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p))).toEqual([]);
      expect(rolesHoldingAny(permissions)).toContain("OWNER");
    }
  });

  it("migration 0052 is exactly what the permissions table generates, and its undo drops exactly its policies and the function", () => {
    expect(migration0052.split("--> statement-breakpoint").slice(1).map((x) => x.trim())).toEqual(generateRiderScopeStatements().map((x) => x.trim()));
    const dropped = [...undo0052.matchAll(/DROP POLICY IF EXISTS (\w+) ON (\w+);/g)].map((m) => `${m[2]}.${m[1]}`).sort();
    expect(dropped).toEqual(riderScopePolicies().map((p) => `${p.table}.${p.policy}`).sort());
    expect(undo0052).toMatch(/DROP FUNCTION IF EXISTS auth_is_rider_scoped\(uuid\);/);
  });

  it("the rider-scope role list is derived from the permissions: a RIDER (and INVENTORY) is not an order reader, every role that works orders is", () => {
    const readers = rolesHoldingAny(ORDER_READER_PERMISSIONS);
    expect(readers).not.toContain("RIDER");
    expect(readers).not.toContain("INVENTORY");
    for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER", "KITCHEN", "ANALYST"] as const) expect(readers).toContain(role);
  });
});

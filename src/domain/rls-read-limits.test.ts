import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES } from "./permissions";
import { CHILD_READ_LIMITS, MEMBERSHIPS_READ, READ_LIMITS, generateReadLimitStatements, readLimitPolicies, rolesHoldingAny } from "./rls-read-limits";

const migration = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0042_rls_role_reads.sql"), "utf8");
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
});

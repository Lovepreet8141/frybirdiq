/** Prints migration 0042's policy statements: `pnpm exec tsx scripts/gen-rls-read-policies.ts`. Reads nothing but src/domain. */
import { RESTORE_MEMBERSHIPS_GRANT, generateRiderScopeStatements, riderScopePolicies, generateReadLimitStatements, generateReadLimitStatements0047, policies0047, readLimitPolicies } from "../src/domain/rls-read-limits";

const mode = process.argv[2];
if (mode === "0051") {
  console.log(generateRiderScopeStatements().join("\n--> statement-breakpoint\n"));
  process.exit(0);
}
if (mode === "0051-down") {
  console.log([...riderScopePolicies().map(({ table, policy }) => `DROP POLICY IF EXISTS ${policy} ON ${table};`), "DROP FUNCTION IF EXISTS auth_is_rider_scoped(uuid);"].join("\n"));
  process.exit(0);
}
if (mode === "0047") {
  console.log(generateReadLimitStatements0047().join("\n--> statement-breakpoint\n"));
  process.exit(0);
}
if (mode === "0047-down") {
  console.log(policies0047().map(({ table, policy }) => `DROP POLICY IF EXISTS ${policy} ON ${table};`).join("\n"));
  process.exit(0);
}
if (mode === "down") {
  console.log([...RESTORE_MEMBERSHIPS_GRANT, ...readLimitPolicies().map(({ table, policy }) => `DROP POLICY IF EXISTS ${policy} ON ${table};`)].join("\n--> statement-breakpoint\n"));
} else {
  console.log(generateReadLimitStatements().join("\n--> statement-breakpoint\n"));
}

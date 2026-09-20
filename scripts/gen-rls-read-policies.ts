/** Prints migration 0042's policy statements: `pnpm exec tsx scripts/gen-rls-read-policies.ts`. Reads nothing but src/domain. */
import { generateReadLimitStatements, readLimitPolicies } from "../src/domain/rls-read-limits";

const mode = process.argv[2];
if (mode === "down") {
  console.log(readLimitPolicies().map(({ table, policy }) => `DROP POLICY IF EXISTS ${policy} ON ${table};`).join("\n--> statement-breakpoint\n"));
} else {
  console.log(generateReadLimitStatements().join("\n--> statement-breakpoint\n"));
}

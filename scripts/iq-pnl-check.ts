import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

/**
 * Prints the profit-and-loss from the command line, so a figure that looks
 * wrong on screen can be checked without a browser. Read-only.
 *
 *     pnpm iq:pnl            # this month
 *     pnpm iq:pnl lastMonth
 */
import { closeDb, db, schema } from "@/db/connection";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { formatBps, formatINR } from "@/lib/money";
import { getProfitAndLoss } from "@/lib/repositories/expenses";

async function main() {
  const orgs = await db().select().from(schema.organizations).limit(1);
  const org = orgs[0];
  if (!org) {
    console.error("No organization found.");
    process.exit(1);
  }

  const key = (process.argv[2] ?? "mtd") as RangeKey;
  const range = resolveRange(key);
  const pnl = await getProfitAndLoss(org.id, range);

  console.log(`\n${org.name} — ${range.label}\n`);
  console.log(`  Revenue            ${formatINR(pnl.revenue, "whole").padStart(14)}   ${pnl.orderCount} paid orders`);

  if (!pnl.hasExpenses) {
    console.log("\n  No costs recorded, so net profit cannot be computed.");
    console.log("  Record expenses at /app/iq/expenses/new\n");
    await closeDb();
    return;
  }

  for (const row of pnl.direct) {
    console.log(`    ${row.name.padEnd(28)} ${formatINR(row.amount, "whole").padStart(12)}`);
  }
  console.log(`  Gross profit       ${formatINR(pnl.result.grossProfit, "whole").padStart(14)}   ${
    pnl.result.grossMarginBps === null ? "—" : formatBps(pnl.result.grossMarginBps, 1)
  }`);
  for (const row of pnl.fixed) {
    console.log(`    ${row.name.padEnd(28)} ${formatINR(row.amount, "whole").padStart(12)}`);
  }
  console.log(`  Net profit         ${formatINR(pnl.result.netProfit, "whole").padStart(14)}   ${
    pnl.result.netMarginBps === null ? "—" : formatBps(pnl.result.netMarginBps, 1)
  }`);
  console.log(`  Food cost          ${
    (pnl.result.foodCostBps === null ? "—" : formatBps(pnl.result.foodCostBps, 1)).padStart(14)
  }`);
  console.log();
  await closeDb();
}

void main();

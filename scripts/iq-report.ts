/**
 * Prints the IQ dashboard figures from the command line.
 *
 *     pnpm iq:report            # today
 *     pnpm iq:report 30d
 *
 * The same repository the dashboard renders, so a number that looks wrong on
 * screen can be checked without a browser. Read-only.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { organizations } from "../src/db/schema";
import { type RangeKey, resolveRange } from "../src/lib/dates";
import { formatBps, formatINR } from "../src/lib/money";
import { getDashboard } from "../src/lib/repositories/analytics";

async function main() {
  const key = (process.argv[2] ?? "30d") as RangeKey;
  const [org] = await db().select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) throw new Error("Run pnpm db:seed first.");

  const range = resolveRange(key);
  const d = await getDashboard(org.id, range);

  const delta = (bps: number | null) => (bps === null ? "no earlier period" : `${bps > 0 ? "+" : ""}${formatBps(bps, 1)}`);

  console.log(`${d.range.label}\n`);
  console.log(`  revenue          ${formatINR(d.revenue.value, "whole").padStart(10)}   ${delta(d.revenue.changeBps)}`);
  console.log(`  orders           ${String(d.orders.value).padStart(10)}   ${delta(d.orders.changeBps)}`);
  console.log(`  average order    ${formatINR(d.averageOrder.value, "whole").padStart(10)}   ${delta(d.averageOrder.changeBps)}`);
  console.log(`  awaiting payment ${formatINR(d.openValue, "whole").padStart(10)}   ${d.openOrders} open`);
  console.log("");
  console.log(`  delivery         ${String(d.delivery.orders).padStart(10)}   ${formatINR(d.delivery.revenue, "whole")}`);
  console.log(`  collection       ${String(d.collection.orders).padStart(10)}   ${formatINR(d.collection.revenue, "whole")}`);

  if (d.topProducts.length > 0) {
    console.log("\n  top sellers by revenue:");
    for (const p of d.topProducts) {
      console.log(`    ${p.name.padEnd(28)} ${String(p.quantity).padStart(3)}  ${formatINR(p.revenue, "whole").padStart(9)}`);
    }
  }

  const busy = d.series.filter((s) => s.orders > 0);
  if (busy.length > 0) {
    console.log("\n  days with sales:");
    for (const s of busy) console.log(`    ${s.date}  ${String(s.orders).padStart(2)} orders  ${formatINR(s.revenue, "whole").padStart(9)}`);
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  });

/** Prints loyalty balances and the movements behind them. Read-only. */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { desc, eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { customers, loyaltyAccounts, loyaltyTransactions } from "../src/db/schema";

async function main() {
  const d = db();
  const accounts = await d.select().from(loyaltyAccounts);
  if (accounts.length === 0) {
    console.log("no loyalty accounts yet");
    return;
  }
  for (const account of accounts) {
    const [customer] = await d.select().from(customers).where(eq(customers.id, account.customerId)).limit(1);
    const moves = await d
      .select()
      .from(loyaltyTransactions)
      .where(eq(loyaltyTransactions.accountId, account.id))
      .orderBy(desc(loyaltyTransactions.createdAt));
    console.log(`${customer?.name ?? "?"}  ${customer?.phone ?? ""}  balance ${account.pointsBalance}`);
    for (const move of moves) console.log(`    ${move.points > 0 ? "+" : ""}${move.points}  ${move.reason}`);
  }
}
main().then(async () => { await closeDb(); process.exit(0); })
  .catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });

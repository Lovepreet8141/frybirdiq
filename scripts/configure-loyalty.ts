/**
 * Sets the loyalty scheme.
 *
 *     pnpm loyalty:show
 *     pnpm loyalty:set --earn 5 --point-value 1
 *     pnpm loyalty:set --min-redeem 100
 *     pnpm loyalty:set --off
 *
 * `--earn` is a percentage back, `--point-value` is what one point is worth in
 * rupees. Zero earn switches the scheme off, which is the state a shop that
 * has not decided its economics should be in.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { organizations } from "../src/db/schema";
import { formatBps, formatINR, fromRupees, paise } from "../src/lib/money";
import { isLoyaltyEnabled, pointsEarned, pointsValue } from "../src/lib/loyalty";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) throw new Error("No FRYBIRD organization. Run pnpm db:seed first.");

  if (process.argv.length > 2 && !process.argv.includes("--show")) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (process.argv.includes("--off")) {
      updates.loyaltyEarnBps = 0;
    } else {
      const earn = flag("earn");
      if (earn !== undefined) updates.loyaltyEarnBps = Math.round(Number(earn) * 100);

      const pointValue = flag("point-value");
      if (pointValue !== undefined) updates.loyaltyPointValue = fromRupees(pointValue);

      const minRedeem = flag("min-redeem");
      if (minRedeem !== undefined) updates.loyaltyMinRedeemPoints = Math.round(Number(minRedeem));
    }

    await database.update(organizations).set(updates).where(eq(organizations.id, org.id));
    console.log("Updated.\n");
  }

  const [current] = await database.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  if (!current) return;

  const scheme = {
    earnBps: current.loyaltyEarnBps,
    pointValue: paise(current.loyaltyPointValue),
    minRedeemPoints: current.loyaltyMinRedeemPoints,
  };

  console.log(`${current.name} loyalty`);
  console.log(`  scheme       : ${isLoyaltyEnabled(scheme) ? "on" : "OFF — set --earn above 0"}`);
  console.log(`  earn         : ${formatBps(scheme.earnBps, 0)} back as points`);
  console.log(`  a point is   : ${formatINR(scheme.pointValue)}`);
  console.log(`  min to spend : ${scheme.minRedeemPoints === 0 ? "no minimum" : `${scheme.minRedeemPoints} points`}`);

  if (isLoyaltyEnabled(scheme)) {
    console.log("\n  what an order earns (food only, delivery excluded):");
    for (const rupees of ["99", "199", "327", "500", "1000"]) {
      const earned = pointsEarned(fromRupees(rupees), scheme);
      console.log(
        `    ${formatINR(fromRupees(rupees)).padStart(8)} → ${String(earned).padStart(3)} points (${formatINR(pointsValue(earned, scheme))})`,
      );
    }
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await closeDb();
    process.exit(1);
  });

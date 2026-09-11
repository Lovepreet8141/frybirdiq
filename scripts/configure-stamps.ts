/**
 * Sets FRYBIRD REWARDS — the one universal stamp card.
 *
 *     pnpm stamps:show
 *     pnpm stamps:set --stamps 7 --min-order 200 --max-reward 250
 *     pnpm stamps:set --off
 *     pnpm stamps:set --on
 *
 * `--min-order` and `--max-reward` are rupees. The same rules the FRYBIRD IQ
 * settings screen writes — this is the CLI equivalent, for a fresh box or a
 * script. Independent of the points program; a customer earns both from the
 * same order.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { organizations } from "../src/db/schema";
import { formatINR, fromRupees, paise } from "../src/lib/money";
import { isStampProgramEnabled } from "../src/lib/loyalty/stamps";

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

    if (process.argv.includes("--off")) updates.stampRewardEnabled = false;
    if (process.argv.includes("--on")) updates.stampRewardEnabled = true;

    const stamps = flag("stamps");
    if (stamps !== undefined) {
      const parsed = Math.round(Number(stamps));
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error("--stamps needs a whole number of 1 or more.");
      updates.stampsRequired = parsed;
    }

    const minOrder = flag("min-order");
    if (minOrder !== undefined) updates.stampMinOrderValue = fromRupees(minOrder);

    const maxReward = flag("max-reward");
    if (maxReward !== undefined) updates.stampMaxRewardValue = fromRupees(maxReward);

    await database.update(organizations).set(updates).where(eq(organizations.id, org.id));
    console.log("Updated.\n");
  }

  const [current] = await database.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  if (!current) return;

  const scheme = {
    enabled: current.stampRewardEnabled,
    stampsRequired: current.stampsRequired,
    minOrderValue: paise(current.stampMinOrderValue),
    maxRewardValue: paise(current.stampMaxRewardValue),
  };

  console.log(`${current.name} — FRYBIRD REWARDS`);
  console.log(`  scheme      : ${isStampProgramEnabled(scheme) ? "on" : "OFF — set --on"}`);
  console.log(`  qualifying  : spend over ${formatINR(scheme.minOrderValue)} on one order`);
  console.log(`  goal        : ${scheme.stampsRequired} stamps`);
  console.log(`  reward      : one free item up to ${formatINR(scheme.maxRewardValue)}`);
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

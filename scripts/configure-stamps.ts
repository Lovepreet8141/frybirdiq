/**
 * Sets the stamp card — "buy 7, get the 8th free."
 *
 *     pnpm stamps:show
 *     pnpm stamps:set --goal 8
 *     pnpm stamps:set --off
 *     pnpm stamps:set --on
 *
 * `--goal` is the visit the free item lands on — 8 means the first seven are
 * paid and the eighth is free. Independent of the points program; a customer
 * earns both from the same order.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { organizations } from "../src/db/schema";
import { isStampRewardEnabled, stampsRequired } from "../src/lib/loyalty/stamps";

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

    const goal = flag("goal");
    if (goal !== undefined) {
      const parsed = Math.round(Number(goal));
      if (!Number.isFinite(parsed) || parsed < 2) throw new Error("--goal needs a whole number of 2 or more.");
      updates.stampRewardGoal = parsed;
    }

    await database.update(organizations).set(updates).where(eq(organizations.id, org.id));
    console.log("Updated.\n");
  }

  const [current] = await database.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  if (!current) return;

  const scheme = { enabled: current.stampRewardEnabled, goal: current.stampRewardGoal };

  console.log(`${current.name} stamp card`);
  console.log(`  scheme : ${isStampRewardEnabled(scheme) ? "on" : "OFF — set --on"}`);
  console.log(`  goal   : buy ${stampsRequired(scheme)}, get the ${scheme.goal}${ordinalSuffix(scheme.goal)} free`);
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
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

/**
 * Creates or updates a promotion code.
 *
 *     pnpm promo:set --code FRYBIRD10 --name "10% off" --percent 10 --min 200 --max 100
 *     pnpm promo:set --code FLAT50 --name "₹50 off" --flat 50 --min 300
 *     pnpm promo:set --code FRYBIRD10 --off
 *     pnpm promo:list
 *
 * Percentages and rupees, converted at the boundary. Exactly one of --percent
 * or --flat: a code that is both is a code nobody can reason about.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, desc, eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { organizations, promotions } from "../src/db/schema";
import { formatBps, formatINR, fromRupees, paise } from "../src/lib/money";
import { normaliseCode } from "../src/lib/promotions";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) throw new Error("Run pnpm db:seed first.");

  const code = flag("code");

  if (code) {
    const normalised = normaliseCode(code);
    const percent = flag("percent");
    const flat = flag("flat");
    if (percent && flat) throw new Error("Give --percent or --flat, not both.");

    const values = {
      orgId: org.id,
      code: normalised,
      name: flag("name") ?? normalised,
      discountBps: percent ? Math.round(Number(percent) * 100) : null,
      discountAmount: flat ? fromRupees(flat) : null,
      minOrderAmount: flag("min") ? fromRupees(flag("min")!) : null,
      maxDiscountAmount: flag("max") ? fromRupees(flag("max")!) : null,
      usageLimit: flag("limit") ? Number(flag("limit")) : null,
      isActive: !process.argv.includes("--off"),
    };

    const [existing] = await database
      .select()
      .from(promotions)
      .where(and(eq(promotions.orgId, org.id), eq(promotions.code, normalised)))
      .limit(1);

    if (existing) {
      await database.update(promotions).set({ ...values, updatedAt: new Date() }).where(eq(promotions.id, existing.id));
      console.log(`Updated ${normalised}.\n`);
    } else {
      await database.insert(promotions).values(values);
      console.log(`Created ${normalised}.\n`);
    }
  }

  const rows = await database
    .select()
    .from(promotions)
    .where(eq(promotions.orgId, org.id))
    .orderBy(desc(promotions.createdAt));

  if (rows.length === 0) {
    console.log("No promotion codes yet.");
    return;
  }

  console.log("code           off         minimum   cap       used   active");
  for (const row of rows) {
    const off = row.discountBps ? formatBps(row.discountBps, 0) : row.discountAmount ? formatINR(paise(row.discountAmount)) : "—";
    console.log(
      `${(row.code ?? `(${row.type})`).padEnd(14)} ${off.padEnd(11)} ${(row.minOrderAmount ? formatINR(paise(row.minOrderAmount)) : "—").padEnd(9)} ${(row.maxDiscountAmount ? formatINR(paise(row.maxDiscountAmount)) : "—").padEnd(9)} ${String(row.usageCount).padStart(4)}   ${row.isActive ? "yes" : "no"}`,
    );
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

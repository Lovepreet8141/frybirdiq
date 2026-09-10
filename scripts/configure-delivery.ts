/**
 * Sets where the outlet is and what it charges to deliver.
 *
 *     pnpm delivery:show
 *     pnpm delivery:set --lat 30.3782 --lng 76.7767 \
 *                       --base 30 --included 2 --per-km 10 --max 8
 *
 * Distances are in kilometres, money in whole rupees — the units a person
 * thinks in. Both are converted at the boundary: kilometres to metres,
 * rupees to paise through `fromRupees`.
 *
 * Delivery stays off until --max is set above zero. That is the correct state
 * for a shop that has not decided what it charges, and nothing here invents a
 * number on its owner's behalf.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { locations, organizations } from "../src/db/schema";
import { formatINR, fromRupees, paise } from "../src/lib/money";
import { formatDistance, fromMicro, toMicro } from "../src/lib/delivery";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function num(name: string): number | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number, got "${raw}"`);
  return value;
}

async function main() {
  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) throw new Error("No FRYBIRD organization. Run pnpm db:seed first.");

  const [location] = await database.select().from(locations).where(eq(locations.orgId, org.id)).limit(1);
  if (!location) throw new Error("No location. Run pnpm db:seed first.");

  const show = process.argv.includes("--show") || process.argv.length <= 2;

  if (!show) {
    const lat = num("lat");
    const lng = num("lng");
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (lat !== undefined && lng !== undefined) {
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error("That is not a point on Earth.");
      updates.latMicro = toMicro(lat);
      updates.lngMicro = toMicro(lng);
    } else if (lat !== undefined || lng !== undefined) {
      throw new Error("Give both --lat and --lng, or neither.");
    }

    const base = flag("base");
    if (base !== undefined) updates.deliveryBaseFee = fromRupees(base);

    const perKm = flag("per-km");
    if (perKm !== undefined) updates.deliveryPerKmFee = fromRupees(perKm);

    const freeAbove = flag("free-above");
    if (freeAbove !== undefined) {
      updates.deliveryFreeAbove = freeAbove === "none" ? null : fromRupees(freeAbove);
    }

    const included = num("included");
    if (included !== undefined) updates.deliveryIncludedMetres = Math.round(included * 1000);

    const max = num("max");
    if (max !== undefined) updates.deliveryMaxMetres = Math.round(max * 1000);

    const roadFactor = num("road-factor");
    if (roadFactor !== undefined) updates.deliveryRoadFactorBps = Math.round(roadFactor * 10_000);

    await database.update(locations).set(updates).where(eq(locations.id, location.id));
    console.log("Updated.\n");
  }

  const [current] = await database.select().from(locations).where(eq(locations.id, location.id)).limit(1);
  if (!current) return;

  const placed = current.latMicro !== null && current.lngMicro !== null;
  const on = current.deliveryMaxMetres > 0;

  console.log(`${current.name} — ${current.city}`);
  console.log(`  on the map     : ${placed ? `${fromMicro(current.latMicro!)}, ${fromMicro(current.lngMicro!)}` : "NOT SET — delivery cannot be priced"}`);
  console.log(`  delivery       : ${on ? "on" : "OFF — set --max above 0 to enable"}`);
  console.log(`  base fee       : ${formatINR(paise(current.deliveryBaseFee))}`);
  console.log(`  covers         : ${formatDistance(current.deliveryIncludedMetres)}`);
  console.log(`  then per km    : ${formatINR(paise(current.deliveryPerKmFee))}`);
  console.log(`  max distance   : ${formatDistance(current.deliveryMaxMetres)}`);
  console.log(`  free above     : ${current.deliveryFreeAbove === null ? "never" : formatINR(paise(current.deliveryFreeAbove))}`);
  console.log(`  road factor    : ${(current.deliveryRoadFactorBps / 10_000).toFixed(2)}× straight line`);

  if (on && placed) {
    console.log("\n  example fees (straight-line distance):");
    for (const km of [1, 2, 3, 5, 8]) {
      const metres = Math.round(km * 1000 * (current.deliveryRoadFactorBps / 10_000));
      if (metres > current.deliveryMaxMetres) {
        console.log(`    ${km} km → outside the delivery area`);
        continue;
      }
      const beyond = Math.max(0, metres - current.deliveryIncludedMetres);
      const fee = paise(current.deliveryBaseFee) + paise(current.deliveryPerKmFee) * BigInt(Math.ceil(beyond / 1000));
      console.log(`    ${km} km → ${formatINR(paise(fee))}`);
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

/**
 * Sets where the outlet is and what it charges to deliver.
 *
 *     pnpm delivery:show
 *     pnpm delivery:set --lat 30.361812 --lng 76.780937
 *     pnpm delivery:set --bands "3:0, 5:30, 8:30+10"
 *     pnpm delivery:set --free-above 500 --road-factor 1.3
 *     pnpm delivery:set --bands off
 *
 * ## Band syntax
 *
 *     upToKm : flatRupees [ +perKmRupees ]
 *
 * `3:0, 5:30, 8:30+10` reads as: free up to 3 km; ₹30 from 3 to 5 km; from 5
 * to 8 km ₹30 plus ₹10 for each started kilometre past 5. Beyond the last
 * band, no delivery.
 *
 * Distances in kilometres, money in whole rupees — the units a person thinks
 * in. Both convert at the boundary: km to metres, rupees to paise through
 * `fromRupees`.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { asc, eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/connection";
import { deliveryBands, locations, organizations } from "../src/db/schema";
import { formatINR, fromRupees, paise } from "../src/lib/money";
import { formatDistance, fromMicro, maxDeliveryMetres, quoteDelivery, toMicro, toPoint } from "../src/lib/delivery";
import type { DeliveryBand } from "../src/lib/delivery";

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

/** Parses "3:0, 5:30, 8:30+10" into bands. */
function parseBands(spec: string): { upToMetres: number; flatFee: bigint; perKmFee: bigint }[] {
  const bands = spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^([\d.]+)\s*:\s*([\d.]+)(?:\s*\+\s*([\d.]+))?$/.exec(part);
      if (!match) throw new Error(`Cannot read band "${part}". Expected  upToKm:flatRs  or  upToKm:flatRs+perKmRs`);
      return {
        upToMetres: Math.round(Number(match[1]) * 1000),
        flatFee: fromRupees(match[2]!),
        perKmFee: match[3] ? fromRupees(match[3]) : 0n,
      };
    })
    .sort((a, b) => a.upToMetres - b.upToMetres);

  if (bands.some((band) => band.upToMetres <= 0)) throw new Error("A band must end past 0 km.");
  const ceilings = bands.map((band) => band.upToMetres);
  if (new Set(ceilings).size !== ceilings.length) throw new Error("Two bands end at the same distance.");
  return bands;
}

async function main() {
  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.slug, "frybird")).limit(1);
  if (!org) throw new Error("No FRYBIRD organization. Run pnpm db:seed first.");

  const [location] = await database.select().from(locations).where(eq(locations.orgId, org.id)).limit(1);
  if (!location) throw new Error("No location. Run pnpm db:seed first.");

  if (!process.argv.includes("--show") && process.argv.length > 2) {
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

    const freeAbove = flag("free-above");
    if (freeAbove !== undefined) {
      updates.deliveryFreeAbove = freeAbove === "none" ? null : fromRupees(freeAbove);
    }

    const roadFactor = num("road-factor");
    if (roadFactor !== undefined) updates.deliveryRoadFactorBps = Math.round(roadFactor * 10_000);

    await database.update(locations).set(updates).where(eq(locations.id, location.id));

    const spec = flag("bands");
    if (spec !== undefined) {
      // Replaced wholesale rather than merged: a half-updated band table would
      // price orders against a structure nobody designed.
      await database.delete(deliveryBands).where(eq(deliveryBands.locationId, location.id));
      if (spec !== "off") {
        const parsed = parseBands(spec);
        await database.insert(deliveryBands).values(
          parsed.map((band) => ({
            orgId: org.id,
            locationId: location.id,
            upToMetres: band.upToMetres,
            flatFee: band.flatFee,
            perKmFee: band.perKmFee,
          })),
        );
      }
    }

    console.log("Updated.\n");
  }

  const [current] = await database.select().from(locations).where(eq(locations.id, location.id)).limit(1);
  if (!current) return;

  const rows = await database
    .select()
    .from(deliveryBands)
    .where(eq(deliveryBands.locationId, location.id))
    .orderBy(asc(deliveryBands.upToMetres));

  const bands: DeliveryBand[] = rows.map((row) => ({
    upToMetres: row.upToMetres,
    flatFee: paise(row.flatFee),
    perKmFee: paise(row.perKmFee),
  }));

  const rates = {
    bands,
    freeAboveOrderValue: current.deliveryFreeAbove === null ? null : paise(current.deliveryFreeAbove),
    freeEnabled: current.deliveryFreeEnabled,
    freeMaxMetres: current.deliveryFreeMaxMetres,
    roadFactorBps: current.deliveryRoadFactorBps,
  };

  const placed = current.latMicro !== null && current.lngMicro !== null;
  const limit = maxDeliveryMetres(rates);

  console.log(`${current.name} — ${current.city}`);
  console.log(`  on the map   : ${placed ? `${fromMicro(current.latMicro!)}, ${fromMicro(current.lngMicro!)}` : "NOT SET — delivery cannot be priced"}`);
  console.log(`  delivery     : ${limit > 0 ? "on" : "OFF — set --bands to enable"}`);
  console.log(`  free above   : ${rates.freeAboveOrderValue === null ? "never" : formatINR(rates.freeAboveOrderValue)}`);
  console.log(`  free enabled : ${rates.freeEnabled ? "yes" : "no"}`);
  console.log(`  free distance: ${rates.freeMaxMetres === null ? "no limit" : formatDistance(rates.freeMaxMetres)}`);
  console.log(`  road factor  : ${(rates.roadFactorBps / 10_000).toFixed(2)}× straight line`);

  if (bands.length > 0) {
    console.log("\n  bands (road distance):");
    let from = 0;
    for (const band of bands) {
      const per = band.perKmFee > 0n ? ` + ${formatINR(band.perKmFee)}/km past ${formatDistance(from)}` : "";
      console.log(
        `    ${formatDistance(from).padStart(7)} – ${formatDistance(band.upToMetres).padEnd(7)} ${
          band.flatFee === 0n && !per ? "free" : formatINR(band.flatFee) + per
        }`,
      );
      from = band.upToMetres;
    }
    console.log(`    beyond ${formatDistance(limit)}  no delivery`);
  }

  if (placed && limit > 0) {
    console.log("\n  what a customer pays, by straight-line distance:");
    const shop = { latMicro: current.latMicro!, lngMicro: current.lngMicro! };
    for (const km of [1, 2, 2.5, 3, 4, 5, 5.5, 6, 7]) {
      const to = toPoint({ lat: fromMicro(current.latMicro!) + km * 0.009, lng: fromMicro(current.lngMicro!) });
      const quote = quoteDelivery({ from: shop, to, rates, orderValue: fromRupees("300") });
      const road = formatDistance(quote.chargeableMetres).padStart(7);
      console.log(
        `    ${String(km).padStart(4)} km straight → ${road} road → ${
          quote.available ? (quote.fee === 0n ? "free" : formatINR(quote.fee)) : "no delivery"
        }`,
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

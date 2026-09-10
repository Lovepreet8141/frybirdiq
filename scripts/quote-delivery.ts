/**
 * Quotes delivery to a point, using the live settings.
 *
 *     pnpm exec tsx --conditions=react-server scripts/quote-delivery.ts 30.3700 76.7850
 *
 * With no arguments it walks a line north from the outlet and prints what each
 * distance costs — a way to check the rate table against reality before a
 * customer sees it.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { closeDb } from "../src/db/connection";
import { getDeliverySettings, quoteForPin } from "../src/lib/repositories/delivery";
import { formatDistance, toLatLng, toPoint } from "../src/lib/delivery";
import { formatINR, fromRupees } from "../src/lib/money";

async function main() {
  const settings = await getDeliverySettings();
  if (!settings?.shop) {
    console.log("The outlet is not on the map. Run pnpm delivery:set --lat .. --lng ..");
    return;
  }

  const shop = toLatLng(settings.shop);
  console.log(`outlet: ${shop.lat}, ${shop.lng}   delivery ${settings.enabled ? "on" : "OFF"}\n`);

  const [latArg, lngArg] = process.argv.slice(2);
  const orderValue = fromRupees("300");

  if (latArg && lngArg) {
    const quote = await quoteForPin({ to: toPoint({ lat: Number(latArg), lng: Number(lngArg) }), orderValue });
    console.log(
      quote.available
        ? `${formatDistance(quote.chargeableMetres)} → ${formatINR(quote.fee)}${quote.waived ? " (waived)" : ""}`
        : `refused — ${quote.reason}`,
    );
    return;
  }

  // Roughly 0.009 degrees of latitude per kilometre.
  console.log("straight-line  road (1.3x)  fee");
  for (const km of [0.5, 1, 2, 3, 4, 5, 6, 7]) {
    const to = toPoint({ lat: shop.lat + km * 0.009, lng: shop.lng });
    const quote = await quoteForPin({ to, orderValue });
    const road = formatDistance(quote.chargeableMetres).padStart(7);
    console.log(
      `${String(km).padStart(11)} km ${road}  ${
        quote.available ? formatINR(quote.fee) : quote.reason
      }`,
    );
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });

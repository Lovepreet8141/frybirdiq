import "server-only";

/**
 * Delivery settings and quoting.
 *
 * The rates live on the outlet, so changing what delivery costs is a settings
 * change and never a deploy.
 */

import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { deliveryBands, locations } from "@/db/schema";
import { type Bps, type Paise, paise } from "@/lib/money";
import { type DeliveryQuote, type DeliveryRates, type MicroPoint, maxDeliveryMetres, quoteDelivery } from "@/lib/delivery";
import { requireOrg } from "./org";

export interface DeliverySettings {
  readonly locationId: string;
  /** Null when the outlet has not been placed on the map. */
  readonly shop: MicroPoint | null;
  readonly rates: DeliveryRates;
  /** Whether delivery can be offered at all. */
  readonly enabled: boolean;
}

export const getDeliverySettings = cache(async (): Promise<DeliverySettings | null> => {
  const org = await requireOrg();
  const [location] = await db().select().from(locations).where(eq(locations.orgId, org.id)).limit(1);
  if (!location) return null;

  const shop =
    location.latMicro !== null && location.lngMicro !== null
      ? { latMicro: location.latMicro, lngMicro: location.lngMicro }
      : null;

  const bands = await db()
    .select()
    .from(deliveryBands)
    .where(eq(deliveryBands.locationId, location.id))
    .orderBy(asc(deliveryBands.upToMetres));

  const rates: DeliveryRates = {
    bands: bands.map((band) => ({
      upToMetres: band.upToMetres,
      flatFee: paise(band.flatFee),
      perKmFee: paise(band.perKmFee),
    })),
    freeAboveOrderValue: location.deliveryFreeAbove === null ? null : paise(location.deliveryFreeAbove),
    roadFactorBps: location.deliveryRoadFactorBps as Bps,
  };

  return {
    locationId: location.id,
    shop,
    rates,
    // Both must hold. Bands without a shop location cannot compute a distance,
    // and a shop location without bands has nothing to charge.
    enabled: shop !== null && maxDeliveryMetres(rates) > 0,
  };
});

/**
 * Prices a delivery to a pin.
 *
 * Returns unavailable rather than throwing when the outlet is unconfigured, so
 * checkout can say "we don't deliver yet" instead of failing.
 */
export async function quoteForPin({
  to,
  orderValue,
}: {
  to: MicroPoint;
  orderValue: Paise;
}): Promise<DeliveryQuote> {
  const settings = await getDeliverySettings();

  if (!settings?.shop || !settings.enabled) {
    return {
      available: false,
      reason: "We don't deliver yet.",
      straightLineMetres: 0,
      chargeableMetres: 0,
    };
  }

  return quoteDelivery({ from: settings.shop, to, rates: settings.rates, orderValue });
}

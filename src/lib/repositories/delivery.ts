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
import { type DeliveryBand, type DeliveryQuote, type DeliveryRates, type MicroPoint, maxDeliveryMetres, quoteDelivery } from "@/lib/delivery";
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
    freeEnabled: location.deliveryFreeEnabled,
    freeMaxMetres: location.deliveryFreeMaxMetres,
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

export interface DeliveryBandInput {
  readonly upToMetres: number;
  readonly flatFee: Paise;
  readonly perKmFee: Paise;
}

export interface DeliveryPricingInput {
  readonly freeEnabled: boolean;
  /** Null clears the threshold — free delivery has nothing to compare the order value against until one is set. */
  readonly freeAboveOrderValue: Paise | null;
  /** Null means no distance restriction. */
  readonly freeMaxMetres: number | null;
  /** The full replacement set of bands, ordered. */
  readonly bands: readonly DeliveryBandInput[];
}

/**
 * Saves the whole "Delivery Pricing" section in one transaction: the
 * free-delivery toggle/threshold/distance on `locations`, and a full
 * replacement of `delivery_bands`.
 *
 * One write, not two, because the settings page has one "Save changes"
 * button over both — a save that updated the free-delivery numbers but
 * failed partway through replacing the bands (or the reverse) would leave
 * the quote engine reading a mix of old and new configuration with nothing
 * on screen to explain why.
 *
 * Bands are a full replace, never a per-row edit: they are a partition of
 * distance (band 2 starts where band 1 ends), so editing one in isolation
 * risks leaving gaps or overlaps a row-by-row API can't see. The caller
 * (`updateDeliveryPricingAction`) validates the whole submitted set first —
 * strictly increasing distances, non-negative fees, sane maximums — before
 * this ever runs; the ordering/sign check here is a second line of defence
 * against a request that reached this function some other way.
 */
export async function updateDeliveryPricing(orgId: string, input: DeliveryPricingInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const [location] = await db().select({ id: locations.id }).from(locations).where(eq(locations.orgId, orgId)).orderBy(asc(locations.createdAt)).limit(1);
  if (!location) return { ok: false, error: "No outlet is configured yet." };

  for (let i = 1; i < input.bands.length; i++) {
    if (input.bands[i]!.upToMetres <= input.bands[i - 1]!.upToMetres) {
      return { ok: false, error: "Distance bands must be in increasing order, each further than the last." };
    }
  }
  if (input.bands.some((band) => band.flatFee < 0n || band.perKmFee < 0n)) {
    return { ok: false, error: "A delivery fee can't be negative." };
  }

  await db().transaction(async (tx) => {
    await tx
      .update(locations)
      .set({
        deliveryFreeEnabled: input.freeEnabled,
        deliveryFreeAbove: input.freeAboveOrderValue,
        deliveryFreeMaxMetres: input.freeMaxMetres,
        updatedAt: new Date(),
      })
      .where(eq(locations.id, location.id));

    await tx.delete(deliveryBands).where(eq(deliveryBands.locationId, location.id));
    if (input.bands.length > 0) {
      await tx.insert(deliveryBands).values(
        input.bands.map((band) => ({
          orgId,
          locationId: location.id,
          upToMetres: band.upToMetres,
          flatFee: band.flatFee,
          perKmFee: band.perKmFee,
        })),
      );
    }
  });

  return { ok: true };
}

/** Read back as `DeliveryBand[]`, for a caller (the settings form) that wants the same shape `quoteDelivery` reads rather than the DB row shape. */
export type { DeliveryBand };

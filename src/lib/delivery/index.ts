/**
 * Delivery distance and pricing.
 *
 * A delivery fee is money the customer is charged, so it obeys the same rules
 * as every other amount: computed here as exact integer paise, never a float,
 * and never assembled in a component.
 *
 * ## Coordinates
 *
 * Stored and compared as **integer microdegrees** (degrees × 1e-6, about 11cm
 * at the equator). Latitude and longitude are not money, but they are compared
 * and stored, and an integer sorts, indexes and round-trips through JSON
 * without the "is 28.1234567 the same point as 28.1234568" question ever
 * arising. Trigonometry happens on decimal degrees, in one place, below.
 *
 * ## Straight line, not roads
 *
 * Distance is great-circle, multiplied by a configurable road factor.
 *
 * The alternative — asking a routing service for real road distance — puts a
 * network call in the checkout path. It can be slow, it can time out, and when
 * it fails the honest options are to block checkout or to charge a fee nobody
 * calculated. §57 says never make failure look like success; a pricing input
 * that can vanish is not one to build a checkout on.
 *
 * Straight-line always answers, always the same way, and the same pin always
 * costs the same. The road factor absorbs the difference — roads in a laid-out
 * sector town typically run 20–40% longer than the crow flies.
 */

import { type Bps, type Paise, ZERO, add, multiply } from "@/lib/money";

/** Degrees × 1e-6, as an integer. */
export type Microdegrees = number;

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface MicroPoint {
  readonly latMicro: Microdegrees;
  readonly lngMicro: Microdegrees;
}

export function toMicro(degrees: number): Microdegrees {
  if (!Number.isFinite(degrees)) throw new RangeError(`delivery: ${degrees} is not a coordinate`);
  return Math.round(degrees * 1_000_000);
}

export function fromMicro(micro: Microdegrees): number {
  return micro / 1_000_000;
}

export function toPoint({ lat, lng }: LatLng): MicroPoint {
  if (lat < -90 || lat > 90) throw new RangeError(`delivery: latitude ${lat} is out of range`);
  if (lng < -180 || lng > 180) throw new RangeError(`delivery: longitude ${lng} is out of range`);
  return { latMicro: toMicro(lat), lngMicro: toMicro(lng) };
}

export function toLatLng({ latMicro, lngMicro }: MicroPoint): LatLng {
  return { lat: fromMicro(latMicro), lng: fromMicro(lngMicro) };
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in whole metres.
 *
 * Rounded to an integer at the boundary so nothing downstream carries a
 * fractional metre into a fee calculation.
 */
export function straightLineMetres(a: MicroPoint, b: MicroPoint): number {
  const from = toLatLng(a);
  const to = toLatLng(b);

  const φ1 = toRadians(from.lat);
  const φ2 = toRadians(to.lat);
  const Δφ = toRadians(to.lat - from.lat);
  const Δλ = toRadians(to.lng - from.lng);

  const h =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * One distance band.
 *
 * Bands are the shape real delivery pricing takes: free nearby, a flat charge
 * for the middle ring, then per-kilometre once it is genuinely far. A single
 * base-plus-per-km formula cannot express "free under 3 km, ₹30 from 3 to 5"
 * without charging per kilometre inside the flat band.
 *
 * Each band covers from the previous band's `upToMetres` to its own. Within a
 * band the customer pays `flatFee`, plus `perKmFee` for each **started**
 * kilometre past where the band begins.
 */
export interface DeliveryBand {
  /** Inclusive upper bound of this band. */
  readonly upToMetres: number;
  /** Charged for any distance falling in this band. */
  readonly flatFee: Paise;
  /** Added per started km beyond where this band begins. Usually zero. */
  readonly perKmFee: Paise;
}

/**
 * What delivery costs, per location.
 *
 * Every number is configured, none assumed. No bands means the outlet does not
 * deliver — the correct state for a shop that has not decided what it charges,
 * and the state it ships in.
 */
export interface DeliveryRates {
  /** Ordered by `upToMetres`, ascending. The last one is the delivery limit. */
  readonly bands: readonly DeliveryBand[];
  /** Order value at or above which delivery is free. Null means never. */
  readonly freeAboveOrderValue: Paise | null;
  /**
   * Straight-line × this ≈ road distance. 13000 bps is 1.3×.
   * 10000 bps means "charge on the crow-flies distance".
   */
  readonly roadFactorBps: Bps;
}

export const DELIVERY_DISABLED: DeliveryRates = {
  bands: [],
  freeAboveOrderValue: null,
  roadFactorBps: 13_000,
};

/** The furthest this outlet will go. Zero when it does not deliver. */
export function maxDeliveryMetres(rates: DeliveryRates): number {
  return rates.bands.at(-1)?.upToMetres ?? 0;
}

export type DeliveryQuote =
  | {
      readonly available: true;
      /** Great-circle metres. */
      readonly straightLineMetres: number;
      /** After the road factor. What the fee is charged on. */
      readonly chargeableMetres: number;
      readonly fee: Paise;
      /** True when the fee was waived by order value. */
      readonly waived: boolean;
    }
  | {
      readonly available: false;
      readonly reason: string;
      readonly straightLineMetres: number;
      readonly chargeableMetres: number;
    };

/**
 * Prices a delivery.
 *
 * Finds the band the distance falls in, then charges that band's flat fee plus
 * any per-kilometre element for the distance past where the band starts.
 *
 * Each **started** kilometre is charged in full rather than pro-rated. That is
 * what a per-km price means to a customer, and it means the same pin always
 * quotes the same fee — one that drifts by a rupee between the cart and the
 * receipt reads as a bug.
 */
export function quoteDelivery({
  from,
  to,
  rates,
  orderValue,
}: {
  from: MicroPoint;
  to: MicroPoint;
  rates: DeliveryRates;
  orderValue: Paise;
}): DeliveryQuote {
  const straight = straightLineMetres(from, to);
  const chargeable = Math.round((straight * rates.roadFactorBps) / 10_000);
  const limit = maxDeliveryMetres(rates);

  if (rates.bands.length === 0) {
    return {
      available: false,
      reason: "We don't deliver yet.",
      straightLineMetres: straight,
      chargeableMetres: chargeable,
    };
  }

  if (chargeable > limit) {
    return {
      available: false,
      reason: `That's outside our delivery area. We deliver up to ${(limit / 1000).toFixed(1)} km.`,
      straightLineMetres: straight,
      chargeableMetres: chargeable,
    };
  }

  if (rates.freeAboveOrderValue !== null && orderValue >= rates.freeAboveOrderValue) {
    return { available: true, straightLineMetres: straight, chargeableMetres: chargeable, fee: ZERO, waived: true };
  }

  // The first band whose ceiling the distance does not exceed.
  let bandStart = 0;
  for (const band of rates.bands) {
    if (chargeable <= band.upToMetres) {
      const beyond = Math.max(0, chargeable - bandStart);
      const startedKm = band.perKmFee === ZERO ? 0 : Math.ceil(beyond / 1000);
      const fee = add(band.flatFee, multiply(band.perKmFee, startedKm));
      return { available: true, straightLineMetres: straight, chargeableMetres: chargeable, fee, waived: false };
    }
    bandStart = band.upToMetres;
  }

  // Unreachable: the limit check above already covers it.
  return {
    available: false,
    reason: "That's outside our delivery area.",
    straightLineMetres: straight,
    chargeableMetres: chargeable,
  };
}

/** Renders a distance the way a person reads one. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}


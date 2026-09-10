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
 * What delivery costs, per location.
 *
 * Every number is configured, none is assumed. Until an outlet has rates set,
 * `maxMetres` is 0 and delivery is simply unavailable — which is the correct
 * behaviour for a shop that has not decided what it charges.
 */
export interface DeliveryRates {
  /** Charged on any delivery order within range. */
  readonly baseFee: Paise;
  /** Distance the base fee already covers. */
  readonly includedMetres: number;
  /** Charged per started kilometre beyond `includedMetres`. */
  readonly perKmFee: Paise;
  /** Beyond this, no delivery. Zero disables delivery entirely. */
  readonly maxMetres: number;
  /** Order value at or above which delivery is free. Null means never. */
  readonly freeAboveOrderValue: Paise | null;
  /**
   * Straight-line distance × this ≈ road distance. 13_000 bps is 1.3×.
   * 10_000 bps means "charge on the crow-flies distance".
   */
  readonly roadFactorBps: Bps;
}

export const DELIVERY_DISABLED: DeliveryRates = {
  baseFee: ZERO,
  includedMetres: 0,
  perKmFee: ZERO,
  maxMetres: 0,
  freeAboveOrderValue: null,
  roadFactorBps: 13_000,
};

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
 * Beyond the included distance, each **started** kilometre is charged in full.
 * Rounding up rather than pro-rating is what a customer expects from a per-km
 * price, and it means the same pin always quotes the same fee — a fee that
 * drifts by a rupee between the cart and the receipt reads as a bug.
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

  if (rates.maxMetres <= 0) {
    return {
      available: false,
      reason: "We don't deliver yet.",
      straightLineMetres: straight,
      chargeableMetres: chargeable,
    };
  }

  if (chargeable > rates.maxMetres) {
    return {
      available: false,
      reason: `That's outside our delivery area. We deliver up to ${(rates.maxMetres / 1000).toFixed(1)} km.`,
      straightLineMetres: straight,
      chargeableMetres: chargeable,
    };
  }

  if (rates.freeAboveOrderValue !== null && orderValue >= rates.freeAboveOrderValue) {
    return { available: true, straightLineMetres: straight, chargeableMetres: chargeable, fee: ZERO, waived: true };
  }

  const beyond = Math.max(0, chargeable - rates.includedMetres);
  const extraKm = Math.ceil(beyond / 1000);
  const fee = add(rates.baseFee, multiply(rates.perKmFee, extraKm));

  return { available: true, straightLineMetres: straight, chargeableMetres: chargeable, fee, waived: false };
}

/** Renders a distance the way a person reads one. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}


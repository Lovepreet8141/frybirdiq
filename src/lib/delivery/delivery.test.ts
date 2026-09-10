import { describe, expect, it } from "vitest";
import { ZERO, formatINR, fromRupees } from "@/lib/money";
import {
  DELIVERY_DISABLED,
  type DeliveryRates,
  formatDistance,
  fromMicro,
  quoteDelivery,
  straightLineMetres,
  toMicro,
  toPoint,
} from "./index";

/** Sector 9, Ambala City — roughly. Used only as a fixed reference point. */
const OUTLET = toPoint({ lat: 30.3782, lng: 76.7767 });

const RATES: DeliveryRates = {
  baseFee: fromRupees("30"),
  includedMetres: 2000,
  perKmFee: fromRupees("10"),
  maxMetres: 8000,
  freeAboveOrderValue: null,
  // Charge on the crow-flies distance, so the arithmetic in these tests is
  // about the fee rules rather than about the road factor.
  roadFactorBps: 10_000,
};

describe("coordinates", () => {
  it("round-trips through microdegrees", () => {
    expect(fromMicro(toMicro(30.3782))).toBeCloseTo(30.3782, 6);
    expect(toMicro(30.3782)).toBe(30_378_200);
  });

  it("stores as an integer, so two identical pins compare equal", () => {
    expect(Number.isInteger(toMicro(76.776712345))).toBe(true);
    expect(toMicro(76.7767001)).toBe(toMicro(76.7767004));
  });

  it("refuses a coordinate that is not on Earth", () => {
    expect(() => toPoint({ lat: 91, lng: 0 })).toThrow(/latitude/);
    expect(() => toPoint({ lat: 0, lng: 181 })).toThrow(/longitude/);
    expect(() => toMicro(Number.NaN)).toThrow(/not a coordinate/);
  });
});

describe("distance", () => {
  it("is zero for the same point", () => {
    expect(straightLineMetres(OUTLET, OUTLET)).toBe(0);
  });

  it("is symmetric", () => {
    const other = toPoint({ lat: 30.39, lng: 76.79 });
    expect(straightLineMetres(OUTLET, other)).toBe(straightLineMetres(other, OUTLET));
  });

  it("measures a known short hop", () => {
    // 0.01 degrees of latitude is about 1.11 km anywhere on Earth.
    const north = toPoint({ lat: 30.3882, lng: 76.7767 });
    expect(straightLineMetres(OUTLET, north)).toBeGreaterThan(1080);
    expect(straightLineMetres(OUTLET, north)).toBeLessThan(1130);
  });

  it("returns whole metres, so no fraction reaches a fee", () => {
    const other = toPoint({ lat: 30.3912, lng: 76.7834 });
    expect(Number.isInteger(straightLineMetres(OUTLET, other))).toBe(true);
  });
});

describe("pricing", () => {
  const quote = (lat: number, lng: number, rates = RATES, orderValue = fromRupees("300")) =>
    quoteDelivery({ from: OUTLET, to: toPoint({ lat, lng }), rates, orderValue });

  it("charges only the base fee inside the included distance", () => {
    const result = quote(30.3800, 76.7780); // a few hundred metres
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.chargeableMetres).toBeLessThan(2000);
    expect(formatINR(result.fee)).toBe("₹30");
  });

  it("charges each started kilometre beyond the included distance", () => {
    // ~3.3 km out: 1.3 km beyond the 2 km included, so two started km.
    const result = quote(30.4080, 76.7767);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.chargeableMetres).toBeGreaterThan(3000);
    expect(result.chargeableMetres).toBeLessThan(3500);
    expect(formatINR(result.fee)).toBe("₹50"); // 30 + 2 × 10
  });

  it("rounds a part kilometre up, so the same pin always costs the same", () => {
    // Pro-rating would make the fee drift by a rupee between cart and receipt.
    const justOver = quoteDelivery({
      from: OUTLET,
      to: toPoint({ lat: 30.3782, lng: 76.7767 }),
      rates: { ...RATES, includedMetres: 0 },
      orderValue: fromRupees("300"),
    });
    expect(justOver.available).toBe(true);
    if (!justOver.available) return;
    // Zero distance is zero started kilometres — the base fee only.
    expect(formatINR(justOver.fee)).toBe("₹30");
  });

  it("refuses a pin beyond the maximum radius", () => {
    const result = quote(30.4700, 76.7767); // ~10 km
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/outside our delivery area/);
    expect(result.reason).toMatch(/8\.0 km/);
  });

  it("applies the road factor before deciding whether the pin is in range", () => {
    // 7 km straight line is inside an 8 km limit, but 1.3× road is not.
    const nearLimit = { ...RATES, roadFactorBps: 13_000 };
    const straight = quote(30.4410, 76.7767, nearLimit);
    expect(straight.chargeableMetres).toBeGreaterThan(straight.straightLineMetres);
    expect(straight.available).toBe(false);
  });

  it("waives the fee above the free-delivery threshold", () => {
    const rates = { ...RATES, freeAboveOrderValue: fromRupees("500") };
    const under = quote(30.4080, 76.7767, rates, fromRupees("499"));
    const over = quote(30.4080, 76.7767, rates, fromRupees("500"));

    expect(under.available && under.fee).toBe(fromRupees("50"));
    expect(over.available && over.fee).toBe(ZERO);
    expect(over.available && over.waived).toBe(true);
  });

  it("says it does not deliver when nothing has been configured", () => {
    // The correct behaviour for a shop that has not decided what it charges.
    const result = quote(30.3800, 76.7780, DELIVERY_DISABLED);
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/don't deliver yet/);
  });

  it("never quotes a negative fee", () => {
    const generous = { ...RATES, includedMetres: 50_000 };
    const result = quote(30.3800, 76.7780, generous);
    expect(result.available && result.fee).toBe(fromRupees("30"));
  });
});

describe("formatDistance", () => {
  it("reads the way a person says it", () => {
    expect(formatDistance(340)).toBe("340 m");
    expect(formatDistance(1250)).toBe("1.3 km");
    expect(formatDistance(8000)).toBe("8.0 km");
  });
});

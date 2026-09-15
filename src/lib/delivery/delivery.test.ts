import { describe, expect, it } from "vitest";
import { ZERO, formatINR, fromRupees } from "@/lib/money";
import {
  DELIVERY_DISABLED,
  type DeliveryRates,
  formatDistance,
  fromMicro,
  maxDeliveryMetres,
  quoteDelivery,
  straightLineMetres,
  toMicro,
  toPoint,
} from "./index";

/** Sector 9, Ambala City — roughly. Used only as a fixed reference point. */
const OUTLET = toPoint({ lat: 30.361812, lng: 76.780937 });

/**
 * FRYBIRD's actual structure: free under 3 km, ₹30 from 3 to 5, then ₹30 plus
 * ₹10 per started kilometre past 5, and nothing beyond 8.
 *
 * The road factor is 1.0 here so these tests are about the band rules rather
 * than about the straight-line-to-road conversion, which has its own test.
 */
const RATES: DeliveryRates = {
  bands: [
    { upToMetres: 3000, flatFee: ZERO, perKmFee: ZERO },
    { upToMetres: 5000, flatFee: fromRupees("30"), perKmFee: ZERO },
    { upToMetres: 8000, flatFee: fromRupees("30"), perKmFee: fromRupees("10") },
  ],
  freeAboveOrderValue: null,
  freeEnabled: false,
  freeMaxMetres: null,
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
    const other = toPoint({ lat: 30.371812, lng: 76.790937 });
    expect(straightLineMetres(OUTLET, other)).toBe(straightLineMetres(other, OUTLET));
  });

  it("measures a known short hop", () => {
    // 0.01 degrees of latitude is about 1.11 km anywhere on Earth.
    const north = toPoint({ lat: 30.371812, lng: 76.780937 });
    expect(straightLineMetres(OUTLET, north)).toBeGreaterThan(1080);
    expect(straightLineMetres(OUTLET, north)).toBeLessThan(1130);
  });

  it("returns whole metres, so no fraction reaches a fee", () => {
    const other = toPoint({ lat: 30.375812, lng: 76.788937 });
    expect(Number.isInteger(straightLineMetres(OUTLET, other))).toBe(true);
  });
});

describe("pricing", () => {
  /**
   * Places a pin a precise number of kilometres due north of the outlet.
   *
   * The constant is derived from the same Earth radius the module's haversine
   * uses (pi x R / 180), not a textbook 111_132. A close-but-different value
   * makes "6 km" land at 6003 m, which tips into the next started kilometre
   * and fails a test for a reason that has nothing to do with the band rules.
   */
  const METRES_PER_DEGREE_LAT = (Math.PI * 6_371_008.8) / 180;
  const atKm = (km: number, rates = RATES, orderValue = fromRupees("300")) =>
    quoteDelivery({
      from: OUTLET,
      to: toPoint({ lat: 30.361812 + (km * 1000) / METRES_PER_DEGREE_LAT, lng: 76.780937 }),
      rates,
      orderValue,
    });

  /** The fee at a distance, or a failure naming the distance that was refused. */
  const feeAt = (km: number, rates = RATES, orderValue = fromRupees("300")) => {
    const quote = atKm(km, rates, orderValue);
    if (!quote.available) throw new Error(`expected a quote at ${km} km, got: ${quote.reason}`);
    return formatINR(quote.fee);
  };

  it("delivers free inside the first band", () => {
    for (const km of [0.5, 1, 2, 2.9]) {
      expect(feeAt(km), `${km} km`).toBe("₹0");
    }
  });

  it("charges a flat ₹30 across the whole middle band", () => {
    // The point of bands: 3.2 km and 4.8 km cost the same. A base-plus-per-km
    // formula would charge these differently.
    expect(feeAt(3.2)).toBe("₹30");
    expect(feeAt(4.8)).toBe("₹30");
  });

  it("adds ₹10 per started kilometre past 5 km", () => {
    expect(feeAt(5.5)).toBe("₹40");
    expect(feeAt(6)).toBe("₹40");
    expect(feeAt(6.5)).toBe("₹50");
    expect(feeAt(7.5)).toBe("₹60");
  });

  it("steps by ₹10 at the 5 km edge, not by ₹30", () => {
    // Charging ₹10 per km on the *total* distance would make 5.1 km cost ₹60,
    // doubling the fee for one extra step. The per-km element applies only to
    // the distance past where the band begins.
    expect(feeAt(4.99)).toBe("₹30");
    expect(feeAt(5.01)).toBe("₹40");
  });

  it("refuses a pin beyond the last band", () => {
    const result = atKm(9);
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/outside our delivery area/);
    expect(result.reason).toMatch(/8\.0 km/);
  });

  it("delivers right up to the limit", () => {
    expect(feeAt(8)).toBe("₹60");
  });

  it("applies the road factor before choosing the band", () => {
    // 2.5 km straight is inside the free band; at 1.3x road it is 3.25 km and
    // lands in the ₹30 band.
    const roads = { ...RATES, roadFactorBps: 13_000 };
    const result = atKm(2.5, roads);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.chargeableMetres).toBeGreaterThan(result.straightLineMetres);
    expect(formatINR(result.fee)).toBe("₹30");
  });

  it("waives the fee above the free-delivery threshold, with no distance limit set", () => {
    const rates = { ...RATES, freeEnabled: true, freeAboveOrderValue: fromRupees("500") };
    expect(feeAt(6, rates, fromRupees("499"))).toBe("₹40");

    const over = atKm(6, rates, fromRupees("500"));
    expect(over.available && over.fee).toBe(ZERO);
    expect(over.available && over.waived).toBe(true);
  });

  it("does not waive the fee when freeEnabled is off, even above the threshold", () => {
    // The standalone toggle, not nullability, decides — configured numbers
    // stay in place but inert while paused.
    const rates = { ...RATES, freeEnabled: false, freeAboveOrderValue: fromRupees("300") };
    expect(feeAt(1, rates, fromRupees("1000"))).toBe("₹0"); // band 1 is free anyway in this fixture
    expect(feeAt(6, rates, fromRupees("1000"))).toBe("₹40"); // would have been waived if enabled
  });

  describe("free-delivery distance gate", () => {
    // The approved rule: free delivery requires ALL of enabled, within the
    // configured distance, and at/above the minimum order value.
    const freeRates: DeliveryRates = { ...RATES, freeEnabled: true, freeAboveOrderValue: fromRupees("300"), freeMaxMetres: 3000 };

    it("<= 3 km + >= ₹300 → FREE", () => {
      const quote = atKm(3, freeRates, fromRupees("300"));
      expect(quote.available && quote.fee).toBe(ZERO);
      expect(quote.available && quote.waived).toBe(true);
    });

    it("<= 3 km + < ₹300 → the configured normal 0–3 km fee, not waived", () => {
      // This fixture's band 1 flat fee happens to be ₹0 — the point is
      // `waived` is false and the band lookup ran, not the number itself.
      const quote = atKm(3, freeRates, fromRupees("299"));
      expect(quote.available && quote.waived).toBe(false);
      expect(feeAt(3, freeRates, fromRupees("299"))).toBe("₹0");
    });

    it("2 km + ₹300 → FREE", () => {
      const quote = atKm(2, freeRates, fromRupees("300"));
      expect(quote.available && quote.waived).toBe(true);
    });

    it("2 km + ₹200 → normal fee, not waived", () => {
      const quote = atKm(2, freeRates, fromRupees("200"));
      expect(quote.available && quote.waived).toBe(false);
    });

    it("3.1 km + ₹300 → beyond the free distance, normal distance-band pricing applies regardless of order value", () => {
      const quote = atKm(3.1, freeRates, fromRupees("10000"));
      expect(quote.available && quote.waived).toBe(false);
      // 3.1 km lands in the 3–5 km band, ₹30 flat in this fixture.
      expect(feeAt(3.1, freeRates, fromRupees("10000"))).toBe("₹30");
    });

    it("has no distance restriction when freeMaxMetres is null — the value threshold alone decides, at any distance in the delivery area", () => {
      const rates = { ...freeRates, freeMaxMetres: null };
      const quote = atKm(6, rates, fromRupees("300"));
      expect(quote.available && quote.waived).toBe(true);
    });
  });

  describe("freeDeliveryGap — 'add ₹X more for free delivery'", () => {
    const freeRates: DeliveryRates = { ...RATES, freeEnabled: true, freeAboveOrderValue: fromRupees("300"), freeMaxMetres: 3000 };

    it("is null once the order already qualifies for free delivery", () => {
      const quote = atKm(2, freeRates, fromRupees("300"));
      expect(quote.available && quote.freeDeliveryGap).toBe(null);
    });

    it("is the exact shortfall when within the free distance but under the minimum", () => {
      const quote = atKm(2, freeRates, fromRupees("250"));
      expect(quote.available && quote.freeDeliveryGap).toBe(fromRupees("50"));
    });

    it("is null beyond the free distance — no amount of extra spend would waive the fee from here", () => {
      const quote = atKm(4, freeRates, fromRupees("50"));
      expect(quote.available && quote.freeDeliveryGap).toBe(null);
    });

    it("is null when free delivery is disabled", () => {
      const rates = { ...freeRates, freeEnabled: false };
      const quote = atKm(2, rates, fromRupees("250"));
      expect(quote.available && quote.freeDeliveryGap).toBe(null);
    });

    it("is null when no threshold is configured at all", () => {
      const rates = { ...freeRates, freeAboveOrderValue: null };
      const quote = atKm(2, rates, fromRupees("250"));
      expect(quote.available && quote.freeDeliveryGap).toBe(null);
    });
  });

  it("says it does not deliver when no bands are configured", () => {
    const result = atKm(1, DELIVERY_DISABLED);
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/don't deliver yet/);
  });

  it("reports the delivery limit from the last band", () => {
    expect(maxDeliveryMetres(RATES)).toBe(8000);
    expect(maxDeliveryMetres(DELIVERY_DISABLED)).toBe(0);
  });

  it("never quotes a negative fee", () => {
    for (const km of [0.1, 3, 5, 7.9]) {
      const quote = atKm(km);
      expect(quote.available && quote.fee >= ZERO, `${km} km`).toBe(true);
    }
  });
});

describe("formatDistance", () => {
  it("reads the way a person says it", () => {
    expect(formatDistance(340)).toBe("340 m");
    expect(formatDistance(1250)).toBe("1.3 km");
    expect(formatDistance(8000)).toBe("8.0 km");
  });
});

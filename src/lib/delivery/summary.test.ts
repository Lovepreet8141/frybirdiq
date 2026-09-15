import { describe, expect, it } from "vitest";
import { ZERO, fromRupees } from "@/lib/money";
import type { DeliveryRates } from "./index";
import { summarizeDeliveryBands, summarizeFreeDelivery } from "./summary";

/** FRYBIRD's actual band structure, the same fixture delivery.test.ts uses. */
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

describe("summarizeDeliveryBands", () => {
  it("describes a free flat band", () => {
    expect(summarizeDeliveryBands(RATES)[0]).toBe("Free up to 3 km");
  });

  it("describes a flat-fee band", () => {
    expect(summarizeDeliveryBands(RATES)[1]).toBe("₹30 up to 5 km");
  });

  it("describes a flat-plus-per-km band, measured from the previous band's edge", () => {
    expect(summarizeDeliveryBands(RATES)[2]).toBe("₹30 + ₹10/km beyond 5 km");
  });

  it("produces nothing when delivery has no bands configured", () => {
    expect(summarizeDeliveryBands({ ...RATES, bands: [] })).toEqual([]);
  });

  it("handles a half-kilometre boundary", () => {
    const rates: DeliveryRates = { ...RATES, bands: [{ upToMetres: 3500, flatFee: ZERO, perKmFee: ZERO }] };
    expect(summarizeDeliveryBands(rates)[0]).toBe("Free up to 3.5 km");
  });
});

describe("summarizeFreeDelivery", () => {
  it("is null when the free-delivery rule is off", () => {
    expect(summarizeFreeDelivery(RATES)).toBeNull();
  });

  it("is null when enabled but never configured with a threshold", () => {
    expect(summarizeFreeDelivery({ ...RATES, freeEnabled: true })).toBeNull();
  });

  it("states the distance gate when one is set", () => {
    const rates: DeliveryRates = { ...RATES, freeEnabled: true, freeAboveOrderValue: fromRupees("300"), freeMaxMetres: 3000 };
    expect(summarizeFreeDelivery(rates)).toBe("Free delivery within 3 km on orders ₹300+");
  });

  it("omits the distance clause when there is no distance restriction", () => {
    const rates: DeliveryRates = { ...RATES, freeEnabled: true, freeAboveOrderValue: fromRupees("300"), freeMaxMetres: null };
    expect(summarizeFreeDelivery(rates)).toBe("Free delivery on orders ₹300+");
  });
});

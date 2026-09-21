import { describe, expect, it } from "vitest";
import { OFFER_KEYS, toOffer } from "./offer";

const full = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: "1301",
  customerName: "Asha Verma",
  customerPhone: "9000000001",
  grandTotal: 34000n,
  isPaid: false,
  placedAt: new Date("2026-09-21T10:00:00Z"),
  items: [{ name: "OG Smash", quantity: 2, modifiers: ["Extra cheese"] }, { name: "Fries", quantity: 1, modifiers: [] }],
  delivery: { line1: "12 Secret Street", landmark: "Behind the temple", lat: 30.37, lng: 76.78, distanceMetres: 2400, fee: 3000n },
  notes: "Ring twice",
};

describe("toOffer", () => {
  it("keeps only the pickup-level facts a rider needs to decide", () => {
    const offer = toOffer(full as never);
    expect(Object.keys(offer).sort()).toEqual([...OFFER_KEYS].sort());
    expect(offer).toMatchObject({ id: full.id, orderNumber: "1301", itemCount: 3, isPaid: false, distanceMetres: 2400 });
  });

  it("never carries anything about the customer or the address, however the source grows", () => {
    const text = JSON.stringify(toOffer({ ...full, extraField: "secret", customerEmail: "a@b.c" } as never), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toMatch(/Asha|9000000001|Secret Street|temple|30\.37|76\.78|Ring twice|a@b\.c|secret|Extra cheese/);
  });

  it("a delivery with no measured distance offers null, not 0", () => {
    expect(toOffer({ ...full, delivery: { ...full.delivery, distanceMetres: null } } as never).distanceMetres).toBeNull();
    expect(toOffer({ ...full, delivery: null } as never).distanceMetres).toBeNull();
  });
});

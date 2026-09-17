import { describe, expect, it } from "vitest";
import { refundFactsDays } from "./refund-facts-days";

// 00:05 IST on 17 Sep is 18:35 UTC on 16 Sep; 23:59 IST on 16 Sep is 18:29 UTC.
const ORDER_PLACED = new Date("2026-08-10T07:00:00Z");
const RESERVED_2359_IST = new Date("2026-09-16T18:29:00Z");
const FINALIZED_0005_IST = new Date("2026-09-16T18:35:00Z");

describe("refundFactsDays", () => {
  it("dates the refund by when it finalized, not when it was reserved: 23:59 reserve, 00:05 finalize", () => {
    const days = refundFactsDays({ orderCreatedAt: ORDER_PLACED, finalizedAt: FINALIZED_0005_IST });
    expect(days).toEqual(["2026-08-10", "2026-09-17"]);
    expect(days).not.toContain(RESERVED_2359_IST.toISOString().slice(0, 10));
    expect(days).not.toContain("2026-09-16");
  });

  it("refreshes one day when the order and the refund share it", () => {
    expect(refundFactsDays({ orderCreatedAt: new Date("2026-09-17T05:00:00Z"), finalizedAt: FINALIZED_0005_IST })).toEqual(["2026-09-17"]);
  });

  it("refreshes only the order's day for a refund that has not finalized", () => {
    expect(refundFactsDays({ orderCreatedAt: ORDER_PLACED, finalizedAt: null })).toEqual(["2026-08-10"]);
  });
});

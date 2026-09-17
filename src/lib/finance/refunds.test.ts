import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { type RefundFacts, isStaleReserved, paymentRefundBadges, refundDate, refundsByPayment, summariseRefunds } from "./refunds";

const NOW = new Date("2026-09-17T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const row = (overrides: Partial<RefundFacts>): RefundFacts => ({ status: "SUCCEEDED", amount: paise(1_000n), provider: "cash", createdAt: minutesAgo(30), finalizedAt: minutesAgo(29), ...overrides });

describe("refundDate", () => {
  it("dates a succeeded refund by when the money went back, anything else by when it was asked for", () => {
    expect(refundDate(row({}))).toEqual(minutesAgo(29));
    expect(refundDate(row({ status: "RESERVED", finalizedAt: null }))).toEqual(minutesAgo(30));
    expect(refundDate(row({ status: "FAILED", finalizedAt: null }))).toEqual(minutesAgo(30));
  });
});

describe("isStaleReserved", () => {
  it("flags cash after 15 minutes and online after 60, never a finished refund", () => {
    expect(isStaleReserved(row({ status: "RESERVED", createdAt: minutesAgo(15) }), NOW)).toBe(false);
    expect(isStaleReserved(row({ status: "RESERVED", createdAt: minutesAgo(16) }), NOW)).toBe(true);
    expect(isStaleReserved(row({ status: "RESERVED", provider: "razorpay", createdAt: minutesAgo(59) }), NOW)).toBe(false);
    expect(isStaleReserved(row({ status: "RESERVED", provider: "razorpay", createdAt: minutesAgo(61) }), NOW)).toBe(true);
    expect(isStaleReserved(row({ status: "SUCCEEDED", createdAt: minutesAgo(600) }), NOW)).toBe(false);
    expect(isStaleReserved(row({ status: "FAILED", createdAt: minutesAgo(600) }), NOW)).toBe(false);
  });
});

describe("summariseRefunds", () => {
  it("sums only SUCCEEDED as refunded, holds RESERVED apart, and never sums FAILED", () => {
    const summary = summariseRefunds(
      [
        row({ amount: paise(1_000n) }),
        row({ amount: paise(2_500n) }),
        row({ status: "RESERVED", amount: paise(700n), finalizedAt: null, createdAt: minutesAgo(5) }),
        row({ status: "RESERVED", amount: paise(300n), finalizedAt: null, createdAt: minutesAgo(20) }),
        row({ status: "FAILED", amount: paise(9_999n), finalizedAt: null }),
      ],
      NOW,
    );
    expect(summary).toEqual({ refundedTotal: 3_500n, refundedCount: 2, reservedTotal: 1_000n, reservedCount: 2, staleReservedCount: 1, failedCount: 1 });
  });

  it("is all zero with no rows", () => {
    expect(summariseRefunds([], NOW)).toEqual({ refundedTotal: 0n, refundedCount: 0, reservedTotal: 0n, reservedCount: 0, staleReservedCount: 0, failedCount: 0 });
  });
});

describe("refundsByPayment", () => {
  it("splits each payment into refunded and held, flags stuck, and counts FAILED without summing it", () => {
    const map = refundsByPayment(
      [
        { paymentId: "p1", status: "SUCCEEDED", amount: paise(1_000n), provider: "cash", createdAt: minutesAgo(60) },
        { paymentId: "p1", status: "RESERVED", amount: paise(400n), provider: "cash", createdAt: minutesAgo(5) },
        { paymentId: "p1", status: "FAILED", amount: paise(5_000n), provider: "cash", createdAt: minutesAgo(90) },
        { paymentId: "p2", status: "FAILED", amount: paise(5_000n), provider: "razorpay", createdAt: minutesAgo(90) },
        { paymentId: "p3", status: "RESERVED", amount: paise(700n), provider: "razorpay", createdAt: minutesAgo(61) },
      ],
      NOW,
    );
    expect(map.get("p1")).toEqual({ refunded: 1_000n, reserved: 400n, stuck: false, failedCount: 1 });
    expect(map.get("p2")).toEqual({ refunded: 0n, reserved: 0n, stuck: false, failedCount: 1 });
    expect(map.get("p3")).toEqual({ refunded: 0n, reserved: 700n, stuck: true, failedCount: 0 });
  });
});

describe("paymentRefundBadges", () => {
  it("shows nothing for a payment with no open or failed refund", () => {
    expect(paymentRefundBadges({ reserved: paise(0n), stuck: false, failedCount: 0 })).toEqual([]);
  });

  it("says in progress, or stuck past the limit, and counts failures", () => {
    expect(paymentRefundBadges({ reserved: paise(400n), stuck: false, failedCount: 0 }).map((b) => b.label)).toEqual(["Refund in progress"]);
    expect(paymentRefundBadges({ reserved: paise(400n), stuck: true, failedCount: 2 }).map((b) => [b.kind, b.label, b.showsHeldAmount])).toEqual([
      ["stuck", "Refund stuck", true],
      ["failed", "2 refunds failed", false],
    ]);
    expect(paymentRefundBadges({ reserved: paise(400n), stuck: false, failedCount: 0 })[0]?.showsHeldAmount).toBe(true);
    expect(paymentRefundBadges({ reserved: paise(0n), stuck: false, failedCount: 1 })[0]?.description).toBe("A refund attempt failed; no money moved");
  });
});

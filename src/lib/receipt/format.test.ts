import { describe, expect, it } from "vitest";
import { fromRupees } from "@/lib/money";
import type { ReceiptRewards } from "./customer-view";
import { formatReceiptTime, formatReceiptWhen, orderTypeLabel, paymentMethodLabel, paymentStatusLabel, scheduledTimeLabel, summarizeRewards } from "./format";

describe("orderTypeLabel", () => {
  it("labels an online delivery order", () => {
    expect(orderTypeLabel("ONLINE", "DELIVERY")).toBe("Online delivery");
  });

  it("labels an online collection order — takeaway doubles as collection for website orders", () => {
    expect(orderTypeLabel("ONLINE", "TAKEAWAY")).toBe("Online collection");
  });

  it("falls back to a plain label for a non-website channel", () => {
    expect(orderTypeLabel("DINE_IN", "DINE_IN")).toBe("Collection");
  });
});

describe("scheduledTimeLabel", () => {
  it("is null for an ASAP order — nothing was requested, so nothing prints", () => {
    expect(scheduledTimeLabel(null)).toBeNull();
  });

  it("prints the requested time for a scheduled order, not the kitchen's promised time", () => {
    const label = scheduledTimeLabel(new Date("2026-09-15T14:30:00+05:30"));
    expect(label).toBe("Requested for 2:30 pm");
  });
});

describe("clock formatting", () => {
  it("formats a placed-at instant in IST", () => {
    expect(formatReceiptWhen(new Date("2026-09-15T13:32:00Z"))).toContain("2026");
  });

  it("prints an em dash for a null instant rather than inventing one", () => {
    expect(formatReceiptWhen(null)).toBe("—");
  });

  it("formats a bare time in IST", () => {
    expect(formatReceiptTime(new Date("2026-09-15T07:02:00Z"))).toBe("12:32 pm");
  });
});

describe("payment labels", () => {
  it("labels every known payment method", () => {
    expect(paymentMethodLabel("UPI")).toBe("UPI");
    expect(paymentMethodLabel("CASH")).toBe("Cash");
    expect(paymentMethodLabel("CARD")).toBe("Card");
    expect(paymentMethodLabel("NETBANKING")).toBe("Net banking");
    expect(paymentMethodLabel("WALLET")).toBe("Wallet");
  });

  it("falls back to the raw value for an unrecognised method rather than hiding it", () => {
    expect(paymentMethodLabel("BITCOIN")).toBe("BITCOIN");
  });

  it("labels every known payment status", () => {
    expect(paymentStatusLabel("CAPTURED")).toBe("Paid");
    expect(paymentStatusLabel("PENDING")).toBe("Pending");
    expect(paymentStatusLabel("REFUNDED")).toBe("Refunded");
    expect(paymentStatusLabel("PARTIALLY_REFUNDED")).toBe("Partially refunded");
  });
});

describe("summarizeRewards", () => {
  const rewards = (overrides: Partial<ReceiptRewards> = {}): ReceiptRewards => ({
    pointsEarnedThisOrder: 0,
    pointsBalance: null,
    stampEarnedThisOrder: false,
    stampCount: 0,
    stampsRequired: 7,
    availableRewardCount: 0,
    maxRewardValue: fromRupees("250"),
    ...overrides,
  });

  it("hides the panel entirely when there is no account, or the programme is off", () => {
    expect(summarizeRewards(null, fromRupees("0"))).toEqual({ kind: "hidden" });
  });

  it("shows redeemed when this order itself spent a free item — takes priority over a ready reward", () => {
    const result = summarizeRewards(rewards({ availableRewardCount: 1 }), fromRupees("150"));
    expect(result).toEqual({ kind: "redeemed", amount: "₹150" });
  });

  it("shows ready when a reward is sitting available and this order didn't redeem one", () => {
    const result = summarizeRewards(rewards({ availableRewardCount: 1, stampCount: 7 }), fromRupees("0"));
    expect(result).toEqual({ kind: "ready", worth: "₹250" });
  });

  it("shows progress with the exact remaining count when no reward is ready yet", () => {
    const result = summarizeRewards(rewards({ stampCount: 5, stampsRequired: 7 }), fromRupees("0"));
    expect(result).toEqual({ kind: "progress", stampsRemaining: 2, worth: "₹250" });
  });

  it("never lets progress go negative if stampCount somehow exceeds stampsRequired", () => {
    const result = summarizeRewards(rewards({ stampCount: 9, stampsRequired: 7 }), fromRupees("0"));
    expect(result.kind === "progress" && result.stampsRemaining).toBe(0);
  });

  it("treats a brand-new account (zero stamps, zero points) as ordinary progress, not as hidden", () => {
    const result = summarizeRewards(rewards(), fromRupees("0"));
    expect(result).toEqual({ kind: "progress", stampsRemaining: 7, worth: "₹250" });
  });
});

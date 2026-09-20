import { describe, expect, it } from "vitest";

import { type Bps, ZERO, add, paise, subtract } from "@/lib/money";
import { type PriceBasis, priceOrder, pricingContext } from "@/lib/pricing";

import { PAY4_DEPLOYED_AT, explainCaptureMismatch } from "./explanations";
import {
  type OrderTotalsRow,
  type ReconWindowRead,
  captureDifference,
  evaluateReconWindow,
  gstLinesBroken,
  invoiceBreak,
  invoiceSequenceBreaks,
  loyaltyStillHeld,
  orderTotalsBreaks,
  parityFlagged,
  reconWindow,
  refundPaymentBreak,
  statusPaymentBroken,
} from "./rules";

const rate = 500 as Bps;

/** The stored row persistOrder would write for a priced order: the identities must hold on real pricing output. */
function storedOrder(basis: PriceBasis, options: { fee?: bigint; discount?: bigint; points?: bigint; stamp?: bigint } = {}): OrderTotalsRow {
  const priced = priceOrder(
    {
      lines: [
        { unitPrice: paise(9_900n), quantity: 3, rateBps: rate, discount: options.stamp ? paise(options.stamp) : undefined },
        { unitPrice: paise(2_000n), quantity: 1, rateBps: rate },
      ],
      fees: options.fee ? [{ label: "Delivery", amount: paise(options.fee), rateBps: rate }] : [],
      orderDiscount: options.discount ? paise(options.discount) : undefined,
    },
    pricingContext({ priceBasis: basis }),
  );
  const points = paise(options.points ?? 0n);
  return {
    orderId: "o1",
    subtotal: priced.listed,
    discountTotal: priced.discount,
    taxableTotal: priced.taxable,
    taxTotal: priced.total,
    cgstTotal: priced.cgst,
    sgstTotal: priced.sgst,
    igstTotal: priced.igst,
    deliveryFee: paise(options.fee ?? 0n),
    packagingFee: ZERO,
    tipAmount: ZERO,
    grandTotal: subtract(priced.gross, points),
    stampRewardDiscount: paise(options.stamp ?? 0n),
    pointsRedeemed: options.points ? 10 : 0,
    lineSubtotalSum: add(...priced.lines.map((l) => l.listed)),
    lineDiscountSum: add(...priced.lines.map((l) => l.discount)),
    linesOffInclusive: priced.lines.filter((l) => add(l.taxable, l.total) !== subtract(l.listed, l.discount)).length,
    linesOffExclusive: priced.lines.filter((l) => l.taxable !== subtract(l.listed, l.discount)).length,
  };
}

describe("orderTotalsBreaks (F1)", () => {
  it("finds nothing on a priced order, under either basis, with a fee, a promo, points and a stamp reward", () => {
    for (const basis of ["inclusive", "exclusive"] as const) {
      expect(orderTotalsBreaks(storedOrder(basis), basis)).toEqual([]);
      expect(orderTotalsBreaks(storedOrder(basis, { fee: 3_000n, discount: 1_500n, points: 1_000n, stamp: 9_900n }), basis)).toEqual([]);
    }
  });

  it("names each broken identity", () => {
    const clean = storedOrder("inclusive", { fee: 3_000n });
    expect(orderTotalsBreaks({ ...clean, grandTotal: add(clean.grandTotal, paise(1n)) }, "inclusive")).toEqual(["GRAND_TOTAL"]);
    expect(orderTotalsBreaks({ ...clean, cgstTotal: add(clean.cgstTotal, paise(1n)), sgstTotal: subtract(clean.sgstTotal, paise(2n)) }, "inclusive")).toEqual(["TAX_SPLIT"]);
    expect(orderTotalsBreaks({ ...clean, lineSubtotalSum: add(clean.lineSubtotalSum, paise(100n)) }, "inclusive")).toEqual(["LINE_SUBTOTALS"]);
    expect(orderTotalsBreaks({ ...clean, deliveryFee: ZERO }, "inclusive")).toEqual(["ORDER_IDENTITY"]);
    expect(orderTotalsBreaks({ ...clean, tipAmount: paise(500n) }, "inclusive")).toEqual(["UNUSED_FEES"]);
    expect(orderTotalsBreaks({ ...clean, stampRewardDiscount: paise(1n) }, "inclusive")).toEqual(["STAMP_DISCOUNT"]);
    expect(orderTotalsBreaks({ ...clean, linesOffInclusive: 1 }, "inclusive")).toEqual(["LINE_IDENTITY"]);
  });

  it("checks points only as a range, since the paise discount is not stored", () => {
    const withPoints = storedOrder("inclusive", { points: 1_000n });
    const gross = add(withPoints.taxableTotal, withPoints.taxTotal);
    expect(orderTotalsBreaks({ ...withPoints, grandTotal: gross }, "inclusive")).toEqual(["POINTS_RANGE"]);
    expect(orderTotalsBreaks({ ...withPoints, grandTotal: paise(-1n) }, "inclusive")).toEqual(["POINTS_RANGE"]);
    expect(orderTotalsBreaks({ ...withPoints, grandTotal: ZERO }, "inclusive")).toEqual([]);
  });
});

describe("capture, status, refund, invoice, GST lines, loyalty", () => {
  it("captureDifference is the absolute paise gap; a double capture before pay-4's deploy is explained, after it is not", () => {
    const before = new Date(PAY4_DEPLOYED_AT.getTime() - 1);
    expect(captureDifference({ orderId: "o", grandTotal: paise(17_900n), capturedEver: paise(35_800n), captureCount: 2, lastCaptureCreatedAt: before })).toBe(17_900n);
    expect(captureDifference({ orderId: "o", grandTotal: paise(17_900n), capturedEver: paise(17_000n), captureCount: 1, lastCaptureCreatedAt: before })).toBe(900n);
    expect(explainCaptureMismatch({ captureCount: 2, lastCaptureCreatedAt: before })).toBe("pay-4");
    expect(explainCaptureMismatch({ captureCount: 2, lastCaptureCreatedAt: PAY4_DEPLOYED_AT })).toBeNull();
    expect(explainCaptureMismatch({ captureCount: 1, lastCaptureCreatedAt: before })).toBeNull();
  });

  it("status_vs_payment: PAID/COMPLETED without capture at any age; pay-later only after closing + 60 min", () => {
    const row = (status: string) => ({ orderId: "o", status, businessDate: "2026-09-10", hasCapture: false });
    const early = new Date("2026-09-10T23:59:00+05:30");
    const late = new Date("2026-09-11T00:01:00+05:30");
    expect(statusPaymentBroken(row("COMPLETED"), "23:00", early)).toBe(true);
    expect(statusPaymentBroken(row("PAID"), "23:00", early)).toBe(true);
    expect(statusPaymentBroken(row("OUT_FOR_DELIVERY"), "23:00", early)).toBe(false);
    expect(statusPaymentBroken(row("OUT_FOR_DELIVERY"), "23:00", late)).toBe(true);
    expect(statusPaymentBroken(row("PENDING_PAYMENT"), "23:00", late)).toBe(false);
    expect(statusPaymentBroken({ ...row("COMPLETED"), hasCapture: true }, "23:00", late)).toBe(false);
  });

  it("refund_vs_payment names each break", () => {
    const p = (status: string, amount: bigint, refunded: bigint) => ({ paymentId: "p", status, amount: paise(amount), refunded: paise(refunded) });
    expect(refundPaymentBreak(p("REFUNDED", 1_000n, 1_001n))).toBe("OVER_REFUNDED");
    expect(refundPaymentBreak(p("REFUNDED", 1_000n, 999n))).toBe("REFUNDED_SHORT");
    expect(refundPaymentBreak(p("PARTIALLY_REFUNDED", 1_000n, 0n))).toBe("PARTIAL_EMPTY");
    expect(refundPaymentBreak(p("PARTIALLY_REFUNDED", 1_000n, 1_000n))).toBe("PARTIAL_FULL");
    expect(refundPaymentBreak(p("CAPTURED", 1_000n, 1n))).toBe("REFUND_ON_CAPTURED");
    expect(refundPaymentBreak(p("PARTIALLY_REFUNDED", 1_000n, 400n))).toBeNull();
    expect(refundPaymentBreak(p("REFUNDED", 1_000n, 1_000n))).toBeNull();
  });

  it("invoice: captured without a number, a number without capture, malformed, wrong financial year; FY gaps and duplicates", () => {
    const at = new Date("2026-09-10T12:00:00+05:30");
    expect(invoiceBreak({ orderId: "o", invoiceNumber: null, invoicedAt: null, hasCapture: true })).toBe("CAPTURED_NOT_INVOICED");
    expect(invoiceBreak({ orderId: "o", invoiceNumber: "2026-27/0001", invoicedAt: at, hasCapture: false })).toBe("INVOICED_NOT_CAPTURED");
    expect(invoiceBreak({ orderId: "o", invoiceNumber: "INV-1", invoicedAt: at, hasCapture: true })).toBe("MALFORMED_NUMBER");
    expect(invoiceBreak({ orderId: "o", invoiceNumber: "2025-26/0001", invoicedAt: at, hasCapture: true })).toBe("WRONG_FINANCIAL_YEAR");
    expect(invoiceBreak({ orderId: "o", invoiceNumber: "2026-27/0001", invoicedAt: at, hasCapture: true })).toBeNull();
    expect(invoiceBreak({ orderId: "o", invoiceNumber: null, invoicedAt: null, hasCapture: false })).toBeNull();
    expect(invoiceSequenceBreaks(["2026-27/0001", "2026-27/0002", "2026-27/0003"], "2026-27")).toEqual({ gaps: 0, duplicates: 0 });
    expect(invoiceSequenceBreaks(["2026-27/0001", "2026-27/0003", "2025-26/0002"], "2026-27")).toEqual({ gaps: 1, duplicates: 0 });
  });

  it("gst_lines: the part no line explains must be exactly the delivery fee", () => {
    const row = { orderId: "o", deliveryFee: paise(3_000n), taxableTotal: paise(30_000n), taxTotal: paise(1_500n), lineTaxableSum: paise(27_143n), lineTaxSum: paise(1_357n), refunded: false };
    expect(gstLinesBroken(row)).toBe(false);
    expect(gstLinesBroken({ ...row, lineTaxSum: paise(1_358n), lineTaxableSum: paise(27_142n) })).toBe(false);
    expect(gstLinesBroken({ ...row, lineTaxSum: paise(1_501n), lineTaxableSum: paise(25_999n) })).toBe(true);
    expect(gstLinesBroken({ ...row, deliveryFee: ZERO })).toBe(true);
    expect(gstLinesBroken({ ...row, deliveryFee: ZERO, lineTaxableSum: row.taxableTotal, lineTaxSum: row.taxTotal })).toBe(false);
  });

  it("loyalty_refund: a held stamp, or earned points never reversed", () => {
    expect(loyaltyStillHeld({ orderId: "o", pointsEarned: 15, hasCustomer: true, pointsReversed: false, stampHeld: false })).toBe(true);
    expect(loyaltyStillHeld({ orderId: "o", pointsEarned: 15, hasCustomer: true, pointsReversed: true, stampHeld: false })).toBe(false);
    expect(loyaltyStillHeld({ orderId: "o", pointsEarned: 0, hasCustomer: true, pointsReversed: false, stampHeld: true })).toBe(true);
    expect(loyaltyStillHeld({ orderId: "o", pointsEarned: 15, hasCustomer: false, pointsReversed: false, stampHeld: false })).toBe(false);
  });
});

describe("evaluateReconWindow", () => {
  const D = "2026-09-10";
  const dates = reconWindow(D);
  const empty = { status: "evaluated", rows: [] } as const;
  const base: ReconWindowRead = {
    date: D,
    dates,
    basis: "inclusive",
    closingTime: "23:00",
    orderTotals: empty,
    captures: empty,
    statusPayments: empty,
    refundPayments: empty,
    invoices: empty,
    invoiceNumbers: empty,
    gstLines: empty,
    loyaltyRefunds: empty,
    parity: { status: "evaluated", rows: dates.map((date) => ({ date, computed: true, mismatchedMetrics: [] })) },
  };
  const NOW = new Date("2026-09-11T02:30:00+05:30");

  it("covers 36 days ending on the run's day, and is CLEAR everywhere with nothing wrong", () => {
    expect(dates).toHaveLength(36);
    expect(dates.at(-1)).toBe(D);
    expect(dates[0]).toBe("2026-08-06");
    const outcomes = evaluateReconWindow(base, NOW);
    expect(outcomes).toHaveLength(8 * 36);
    expect(outcomes.every((o) => o.status === "CLEAR")).toBe(true);
  });

  it("fires on the finding's own day, splits explained from unexplained, and sums the money", () => {
    const before = new Date(PAY4_DEPLOYED_AT.getTime() - 60_000);
    const outcomes = evaluateReconWindow(
      {
        ...base,
        captures: {
          status: "evaluated",
          rows: [
            { day: "2026-09-01", orderId: "a", grandTotal: paise(17_900n), capturedEver: paise(35_800n), captureCount: 2, lastCaptureCreatedAt: before },
            { day: "2026-09-01", orderId: "b", grandTotal: paise(10_000n), capturedEver: paise(9_000n), captureCount: 1, lastCaptureCreatedAt: before },
          ],
        },
      },
      NOW,
    );
    const fired = outcomes.filter((o) => o.status === "FIRED");
    expect(fired).toEqual([
      { ruleId: "recon.capture_vs_total", date: "2026-09-01", status: "FIRED", unexplained: 1, explained: 1, explainedBy: "pay-4", amount: 18_900n, breaks: { MULTIPLE_CAPTURES: 1, AMOUNT_MISMATCH: 1 } },
    ]);
  });

  it("a timed-out rule is NOT_EVALUATED for every day; a day without facts is 'not checked', never clear", () => {
    const outcomes = evaluateReconWindow(
      { ...base, gstLines: { status: "timeout" }, parity: { status: "evaluated", rows: [{ date: D, computed: false, mismatchedMetrics: [] }, { date: "2026-09-09", computed: true, mismatchedMetrics: ["revenue_net"] }] } },
      NOW,
    );
    const gst = outcomes.filter((o) => o.ruleId === "recon.gst_lines");
    expect(gst.every((o) => o.status === "NOT_EVALUATED" && o.reason === "rule_timeout")).toBe(true);
    const parity = outcomes.filter((o) => o.ruleId === "recon.facts_parity");
    expect(parity.find((o) => o.date === D)).toMatchObject({ status: "NOT_EVALUATED", reason: "facts_not_computed" });
    expect(parity.find((o) => o.date === "2026-09-09")).toMatchObject({ status: "FIRED", unexplained: 1, breaks: { revenue_net: 1 } });
    expect(parity.find((o) => o.date === "2026-08-06")).toMatchObject({ status: "NOT_EVALUATED" });
    expect(parityFlagged({ date: "2026-09-09", computed: true, mismatchedMetrics: ["revenue_net"] })).toBe(true);
    expect(parityFlagged({ date: D, computed: false, mismatchedMetrics: ["revenue_net"] })).toBe(false);
  });

  it("reports financial-year invoice gaps on the run's own day only", () => {
    const outcomes = evaluateReconWindow({ ...base, invoiceNumbers: { status: "evaluated", rows: ["2026-27/0001", "2026-27/0003"] } }, NOW);
    const invoice = outcomes.filter((o) => o.ruleId === "recon.invoice" && o.status === "FIRED");
    expect(invoice).toEqual([{ ruleId: "recon.invoice", date: D, status: "FIRED", unexplained: 1, explained: 0, explainedBy: null, amount: null, breaks: { FY_GAP: 1 } }]);
  });
});


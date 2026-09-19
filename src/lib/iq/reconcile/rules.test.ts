import { describe, expect, it } from "vitest";

import { type Bps, ZERO, add, paise, subtract } from "@/lib/money";
import { type PriceBasis, priceOrder, pricingContext } from "@/lib/pricing";

import { PAY4_DEPLOYED_AT, explainCaptureMismatch } from "./explanations";
import {
  type GstLinesRow,
  type OrderTotalsRow,
  type ReconWindowRead,
  captureDifference,
  evaluateReconWindow,
  feeGstBroken,
  gstLinesBreak,
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
    lineCount: priced.lines.length,
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
    expect(orderTotalsBreaks({ ...clean, cgstTotal: add(clean.cgstTotal, paise(1n)), sgstTotal: subtract(clean.sgstTotal, paise(2n)) }, "inclusive")).toEqual(["TAX_SPLIT", "CGST_SGST_UNEVEN"]);
    expect(orderTotalsBreaks({ ...clean, lineSubtotalSum: add(clean.lineSubtotalSum, paise(100n)) }, "inclusive")).toEqual(["LINE_SUBTOTALS"]);
    expect(orderTotalsBreaks({ ...clean, deliveryFee: ZERO }, "inclusive")).toEqual(["ORDER_IDENTITY"]);
    expect(orderTotalsBreaks({ ...clean, tipAmount: paise(500n) }, "inclusive")).toEqual(["UNUSED_FEES"]);
    expect(orderTotalsBreaks({ ...clean, stampRewardDiscount: paise(1n) }, "inclusive")).toEqual(["STAMP_DISCOUNT"]);
    expect(orderTotalsBreaks({ ...clean, linesOffInclusive: 1 }, "inclusive")).toEqual(["LINE_IDENTITY"]);
  });

  it("checks the intra-state shape of the split, not only that it sums", () => {
    // FRYBIRD is one location in Haryana: every supply is intra-state, so the
    // whole tax is CGST + SGST, half each. These all keep cgst + sgst + igst =
    // tax_total, which is exactly why the sum alone does not catch them.
    const clean = storedOrder("inclusive", { fee: 3_000n });
    const all = (row: Partial<OrderTotalsRow>) => orderTotalsBreaks({ ...clean, ...row }, "inclusive");
    expect(all({ cgstTotal: clean.taxTotal, sgstTotal: ZERO })).toEqual(["CGST_SGST_UNEVEN"]);
    // All of it in IGST still sums to tax_total and leaves cgst = sgst = 0.
    expect(all({ cgstTotal: ZERO, sgstTotal: ZERO, igstTotal: clean.taxTotal })).toEqual(["IGST_PRESENT"]);
    // Real pricing output passes: an odd tax cannot halve evenly, so CGST may
    // run up to one paise per allocation ahead of SGST — two lines and a fee
    // here — and that is the whole tolerance, nothing wider.
    expect(all({})).toEqual([]);
    expect(subtract(clean.cgstTotal, clean.sgstTotal) <= BigInt(clean.lineCount + 1)).toBe(true);
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

  it("gst_lines: the part no line explains must be exactly the delivery fee, under the org's basis", () => {
    // Two lines at 5% inclusive, plus a ₹30 delivery fee that contains its own tax.
    const line = (net: bigint, taxable: bigint, tax: bigint) => ({ net: paise(net), rateBps: rate, taxable: paise(taxable), tax: paise(tax) });
    const row: GstLinesRow = {
      orderId: "o",
      deliveryFee: paise(3_000n),
      taxableTotal: paise(30_000n),
      taxTotal: paise(1_500n),
      lineTaxableSum: paise(27_143n),
      lineTaxSum: paise(1_357n),
      refunded: false,
      lines: [line(20_000n, 19_048n, 952n), line(8_500n, 8_095n, 405n)],
    };
    expect(gstLinesBreak(row, "inclusive")).toBeNull();
    expect(gstLinesBreak({ ...row, lineTaxSum: paise(1_501n), lineTaxableSum: paise(25_999n) }, "inclusive")).toBe("FEE_GST_MISMATCH");
    expect(gstLinesBreak({ ...row, deliveryFee: ZERO }, "inclusive")).toBe("FEE_GST_MISMATCH");
    expect(gstLinesBreak({ ...row, deliveryFee: ZERO, lineTaxableSum: row.taxableTotal, lineTaxSum: row.taxTotal, lines: [] }, "inclusive")).toBeNull();
  });

  it("gst_lines: the fee identity follows price_basis and is never decided here", () => {
    // Exclusive: the fee is the taxable value and its tax is added on top, so
    // taxable + tax exceeds delivery_fee by the tax. Checked as inclusive it
    // would fire on every delivery order.
    const priced = priceOrder({ lines: [{ unitPrice: paise(9_900n), quantity: 1, rateBps: rate }], fees: [{ label: "Delivery", amount: paise(3_000n), rateBps: rate }] }, pricingContext({ priceBasis: "exclusive" }));
    const first = priced.lines[0]!;
    const row: GstLinesRow = {
      orderId: "o",
      deliveryFee: paise(3_000n),
      taxableTotal: priced.taxable,
      taxTotal: priced.total,
      lineTaxableSum: first.taxable,
      lineTaxSum: first.total,
      refunded: false,
      lines: [{ net: subtract(first.listed, first.discount), rateBps: rate, taxable: first.taxable, tax: first.total }],
    };
    expect(gstLinesBreak(row, "exclusive")).toBeNull();
    // Checked as inclusive the same stored row breaks: the fee residual alone
    // exceeds delivery_fee by its tax. (The line check trips first on the
    // whole-row call, so the fee identity is asserted directly.)
    expect(feeGstBroken(row, "exclusive")).toBe(false);
    expect(feeGstBroken(row, "inclusive")).toBe(true);
    expect(gstLinesBreak(row, "inclusive")).not.toBeNull();
  });

  it("gst_lines: catches tax moved out of a line into its taxable value, which every other identity survives", () => {
    const priced = priceOrder({ lines: [{ unitPrice: paise(9_900n), quantity: 1, rateBps: rate }] }, pricingContext({ priceBasis: "inclusive" }));
    const first = priced.lines[0]!;
    const clean: GstLinesRow = {
      orderId: "o",
      deliveryFee: ZERO,
      taxableTotal: priced.taxable,
      taxTotal: priced.total,
      lineTaxableSum: first.taxable,
      lineTaxSum: first.total,
      refunded: false,
      lines: [{ net: first.listed, rateBps: rate, taxable: first.taxable, tax: first.total }],
    };
    expect(gstLinesBreak(clean, "inclusive")).toBeNull();

    // 100 paise moved from tax to taxable: the line still adds to its net, the
    // order totals still add up, the fee residual is unchanged — and ₹1 of
    // output GST has gone missing.
    const moved = paise(100n);
    const understated: GstLinesRow = {
      ...clean,
      taxableTotal: add(clean.taxableTotal, moved),
      taxTotal: subtract(clean.taxTotal, moved),
      lineTaxableSum: add(clean.lineTaxableSum, moved),
      lineTaxSum: subtract(clean.lineTaxSum, moved),
      lines: [{ ...clean.lines[0]!, taxable: add(first.taxable, moved), tax: subtract(first.total, moved) }],
    };
    expect(add(understated.lines[0]!.taxable, understated.lines[0]!.tax)).toBe(understated.lines[0]!.net);
    expect(gstLinesBreak(understated, "inclusive")).toBe("LINE_TAX_MISMATCH");
    // A refund does not rewrite lines, so the rate check still runs on one.
    expect(gstLinesBreak({ ...understated, refunded: true }, "inclusive")).toBe("LINE_TAX_MISMATCH");
  });

  it("gst_lines: a landed refund holds back only the fee residual, and says so", () => {
    const row: GstLinesRow = {
      orderId: "o",
      deliveryFee: paise(3_000n),
      taxableTotal: paise(30_000n),
      taxTotal: paise(1_500n),
      lineTaxableSum: paise(27_143n),
      lineTaxSum: paise(1_357n),
      refunded: true,
      lines: [{ net: paise(28_500n), rateBps: rate, taxable: paise(27_143n), tax: paise(1_357n) }],
    };
    expect(gstLinesBreak(row, "inclusive")).toBe("NOT_CHECKED_REFUNDED");
    expect(gstLinesBreak({ ...row, refunded: false }, "inclusive")).toBeNull();
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
    parity: { status: "evaluated", rows: dates.map((date) => ({ date, checked: true, notCheckedReason: null, mismatchedMetrics: [] })) },
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
      { ...base, gstLines: { status: "timeout" }, parity: { status: "evaluated", rows: [{ date: D, checked: false, notCheckedReason: "facts_not_computed", mismatchedMetrics: [] }, { date: "2026-09-08", checked: false, notCheckedReason: "rows_recently_changed", mismatchedMetrics: [] }, { date: "2026-09-09", checked: true, notCheckedReason: null, mismatchedMetrics: ["revenue_net"] }] } },
      NOW,
    );
    const gst = outcomes.filter((o) => o.ruleId === "recon.gst_lines");
    expect(gst.every((o) => o.status === "NOT_EVALUATED" && o.reason === "rule_timeout")).toBe(true);
    const parity = outcomes.filter((o) => o.ruleId === "recon.facts_parity");
    expect(parity.find((o) => o.date === D)).toMatchObject({ status: "NOT_EVALUATED", reason: "facts_not_computed" });
    expect(parity.find((o) => o.date === "2026-09-09")).toMatchObject({ status: "FIRED", unexplained: 1, breaks: { revenue_net: 1 } });
    expect(parity.find((o) => o.date === "2026-08-06")).toMatchObject({ status: "NOT_EVALUATED" });
    expect(parity.find((o) => o.date === "2026-09-08")).toMatchObject({ status: "NOT_EVALUATED", reason: "rows_recently_changed" });
    expect(parityFlagged({ date: "2026-09-09", checked: true, notCheckedReason: null, mismatchedMetrics: ["revenue_net"] })).toBe(true);
    expect(parityFlagged({ date: D, checked: false, notCheckedReason: "rows_recently_changed", mismatchedMetrics: ["revenue_net"] })).toBe(false);
  });

  it("reports financial-year invoice gaps on the run's own day only", () => {
    const outcomes = evaluateReconWindow({ ...base, invoiceNumbers: { status: "evaluated", rows: ["2026-27/0001", "2026-27/0003"] } }, NOW);
    const invoice = outcomes.filter((o) => o.ruleId === "recon.invoice" && o.status === "FIRED");
    expect(invoice).toEqual([{ ruleId: "recon.invoice", date: D, status: "FIRED", unexplained: 1, explained: 0, explainedBy: null, amount: null, breaks: { FY_GAP: 1 } }]);
  });
});


/**
 * GST — Indian goods and services tax.
 *
 * BUILD-PLAN.md §50 lists a generic `tax_rules` table. That is not enough to
 * issue a legal receipt in Haryana. A GST invoice has to show the tax split
 * into its components, carry an HSN/SAC code per line, and print the seller's
 * GSTIN. Getting the split wrong is a compliance problem, not a rounding
 * problem, so it lives in its own module with its own tests.
 *
 * FRYBIRD sells in Ambala to customers in Ambala, so in practice every sale is
 * intra-state and splits into CGST + SGST. Inter-state (IGST) is modelled
 * anyway because it is one branch, and discovering later that the schema
 * cannot express it would mean a migration across every order row.
 *
 * This module computes tax. It does not decide rates — rates live on the
 * product, because a restaurant service line and a bottled soft drink are
 * taxed differently and only the menu knows which is which.
 */

import { type Bps, type Paise, ZERO, allocate, percentOf, subtract } from "@/lib/money";

/** Where the customer is relative to the outlet. Decides the tax split. */
export type PlaceOfSupply = "intra-state" | "inter-state";

/** Whether the listed price already contains the tax. */
export type PriceBasis = "exclusive" | "inclusive";

export interface GstBreakdown {
  /** The pre-tax value of the line. */
  readonly taxable: Paise;
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly igst: Paise;
  /** cgst + sgst + igst. */
  readonly total: Paise;
  /** taxable + total. What the customer pays. */
  readonly gross: Paise;
}

/**
 * Splits a tax amount into its components.
 *
 * Intra-state tax divides in half between CGST and SGST. An odd paise cannot
 * divide evenly, so it is allocated rather than rounded twice — rounding each
 * half independently would make the components fail to sum to the total, and a
 * receipt whose parts do not add up is a receipt that gets questioned.
 */
export function splitTax(
  tax: Paise,
  place: PlaceOfSupply,
): Pick<GstBreakdown, "cgst" | "sgst" | "igst"> {
  if (place === "inter-state") {
    return { cgst: ZERO, sgst: ZERO, igst: tax };
  }
  const [cgst, sgst] = allocate(tax, [1, 1]);
  return { cgst, sgst, igst: ZERO };
}

/**
 * Computes GST on an amount.
 *
 * With `exclusive` basis the amount is the taxable value and tax is added on
 * top — how a QSR bill is normally built. With `inclusive` basis the amount is
 * what the customer pays and the tax is extracted from within it, which is how
 * an aggregator's listed price usually works. The two are not interchangeable:
 * 5% added to ₹100 is ₹105, but ₹100 inclusive of 5% is ₹95.24 + ₹4.76.
 */
export function gst(
  amount: Paise,
  rate: Bps,
  { place = "intra-state", basis = "exclusive" }: { place?: PlaceOfSupply; basis?: PriceBasis } = {},
): GstBreakdown {
  const taxable =
    basis === "exclusive"
      ? amount
      : // taxable = gross × 10000 / (10000 + rate), so taxable + tax === gross exactly.
        (((amount * 10_000n) / BigInt(10_000 + rate)) as Paise);

  const total = basis === "exclusive" ? percentOf(taxable, rate) : subtract(amount, taxable);
  const gross = basis === "exclusive" ? ((taxable + total) as Paise) : amount;

  return { taxable, ...splitTax(total, place), total, gross };
}

/**
 * Sums line-level breakdowns into an order-level one.
 *
 * Tax is computed per line and then summed, never computed once on the order
 * total. Lines can carry different rates — a burger at 5% beside a bottled
 * drink at 12% — and collapsing them first would tax both at whichever rate
 * won.
 */
export function sumGst(lines: readonly GstBreakdown[]): GstBreakdown {
  return lines.reduce<GstBreakdown>(
    (running, line) => ({
      taxable: (running.taxable + line.taxable) as Paise,
      cgst: (running.cgst + line.cgst) as Paise,
      sgst: (running.sgst + line.sgst) as Paise,
      igst: (running.igst + line.igst) as Paise,
      total: (running.total + line.total) as Paise,
      gross: (running.gross + line.gross) as Paise,
    }),
    { taxable: ZERO, cgst: ZERO, sgst: ZERO, igst: ZERO, total: ZERO, gross: ZERO },
  );
}

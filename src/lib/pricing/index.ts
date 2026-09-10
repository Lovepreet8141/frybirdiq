/**
 * Pricing — the one path from a menu price to what a customer pays and what
 * the business earns.
 *
 * Every price, invoice line and margin figure goes through this module. None
 * of them decide the GST basis for themselves; they read it from the
 * organization, which is the single switch.
 *
 * ## Why the basis matters this much
 *
 * A ₹99 burger at 5% GST:
 *
 * | Basis | Customer pays | Business earns | GST |
 * |---|---|---|---|
 * | exclusive | ₹103.95 | ₹99.00 | ₹4.95 |
 * | inclusive | ₹99.00 | ₹94.29 | ₹4.71 |
 *
 * The two differ by the tax rate on every order ever taken. Revenue, food
 * cost percentage and margin all move. That is why the flag is one value on
 * the organization and not a column on `products` — a per-product answer can
 * drift, and drift here is silent revenue error rather than a visible bug.
 *
 * GST is never revenue. It is collected on the government's behalf, so every
 * margin figure here works from `taxable` — the net-of-tax amount — and never
 * from `gross`.
 *
 * There is no commission model here. FRYBIRD sells direct — dine-in, counter
 * and its own website — so margin is revenue net of tax, minus cost, and
 * nothing else. Adding an aggregator later means adding a commission term and
 * revisiting every revenue figure; it does not mean quietly threading an
 * optional argument back through these functions.
 */

import { type Bps, type Paise, ZERO, add, allocate, multiply, ratioBps, subtract } from "@/lib/money";
import { type GstBreakdown, type PlaceOfSupply, type PriceBasis, gst, sumGst } from "@/lib/tax/gst";

export type { PriceBasis, PlaceOfSupply };

/**
 * The basis a new organization starts on.
 *
 * `inclusive` — confirmed against a real FRYBIRD counter bill. The price on
 * the menu board is the price the customer pays; GST is inside it, not added
 * at the till. A ₹99 burger takes ₹99 and books ₹94.29 of revenue against
 * ₹4.71 of GST payable.
 *
 * This is a finding, not an assumption. It was `exclusive` until the bill was
 * checked, and that assumption overstated revenue by the tax rate on every
 * order.
 */
export const DEFAULT_PRICE_BASIS: PriceBasis = "inclusive";

/** Everything the pricing functions need to know about the seller. */
export interface PricingContext {
  readonly basis: PriceBasis;
  readonly place: PlaceOfSupply;
}

/**
 * Builds the context from an organization row.
 *
 * The only supported way to obtain a basis. Nothing constructs a
 * `PricingContext` by hand outside tests, because that is how a second source
 * of truth appears.
 */
export function pricingContext(
  org: { priceBasis: PriceBasis },
  { place = "intra-state" }: { place?: PlaceOfSupply } = {},
): PricingContext {
  return { basis: org.priceBasis, place };
}

export interface LineInput {
  /** The listed price of one unit, before modifiers. */
  readonly unitPrice: Paise;
  readonly quantity: number;
  /** Per-unit price deltas from modifiers — size, heat, extra cheese. */
  readonly modifierDeltas?: readonly Paise[];
  /** An absolute discount on this line, applied before tax in both modes. */
  readonly discount?: Paise;
  readonly rateBps: Bps;
}

export interface PricedLine extends GstBreakdown {
  /** Listed value of the line before any discount. */
  readonly listed: Paise;
  readonly discount: Paise;
}

/**
 * Prices one order line.
 *
 * The discount comes off before tax under both bases. Under `exclusive` that
 * reduces the taxable value directly; under `inclusive` it reduces the gross,
 * and the tax inside it shrinks proportionally. Either way the customer is
 * taxed on what they actually pay, not on the pre-discount price.
 */
export function priceLine(input: LineInput, context: PricingContext): PricedLine {
  const perUnit = add(input.unitPrice, ...(input.modifierDeltas ?? []));
  const listed = multiply(perUnit, input.quantity);
  const discount = input.discount ?? ZERO;
  const net = subtract(listed, discount);

  const breakdown = gst(net, input.rateBps, { basis: context.basis, place: context.place });

  return { ...breakdown, listed, discount };
}

/**
 * A charge that is not a menu line — delivery, packaging.
 *
 * Taxed, because a delivery charge made by the restaurant is part of the same
 * composite supply as the food and carries the same rate. Treating it as
 * tax-free would understate GST on every delivery order.
 *
 * It follows the organization's basis like everything else: under inclusive
 * pricing a ₹30 delivery fee takes ₹30 and contains its own tax, so the figure
 * quoted at checkout is the figure paid.
 */
export interface FeeInput {
  readonly label: string;
  readonly amount: Paise;
  readonly rateBps: Bps;
}

export interface OrderInput {
  readonly lines: readonly LineInput[];
  /** Delivery, packaging. Discounts never apply to these. */
  readonly fees?: readonly FeeInput[];
  /**
   * A discount on the whole order — a promo code.
   *
   * Spread across lines by their listed value using largest-remainder
   * allocation, so the parts sum to exactly the discount and each line's tax
   * is computed on its own reduced value. Applying it once to the order total
   * instead would tax lines at the wrong rate whenever they differ.
   */
  readonly orderDiscount?: Paise;
}

export interface PricedFee extends GstBreakdown {
  readonly label: string;
}

export interface PricedOrder extends GstBreakdown {
  readonly lines: readonly PricedLine[];
  readonly fees: readonly PricedFee[];
  /** Menu value before discount. Excludes fees. */
  readonly listed: Paise;
  readonly discount: Paise;
  /** What the fees add, tax included. */
  readonly feeTotal: Paise;
}

export function priceOrder(input: OrderInput, context: PricingContext): PricedOrder {
  const listedPerLine = input.lines.map((line) =>
    multiply(add(line.unitPrice, ...(line.modifierDeltas ?? [])), line.quantity),
  );
  const listed = add(...listedPerLine);
  const orderDiscount = input.orderDiscount ?? ZERO;

  // Weighting by listed value means a ₹300 line absorbs more of the discount
  // than a ₹60 one. A zero-value order cannot be weighted, so nothing is
  // allocated rather than dividing by zero.
  const allocated =
    orderDiscount === ZERO || listed === ZERO
      ? listedPerLine.map(() => ZERO)
      : allocate(orderDiscount, listedPerLine.map((value) => Number(value)));

  const lines = input.lines.map((line, index) =>
    priceLine({ ...line, discount: add(line.discount ?? ZERO, allocated[index] ?? ZERO) }, context),
  );

  const fees = (input.fees ?? []).map((fee) => ({
    label: fee.label,
    ...gst(fee.amount, fee.rateBps, { basis: context.basis, place: context.place }),
  }));

  // Fees are summed alongside the lines, so taxable + tax === gross still holds
  // across the whole order rather than only across the food.
  const totals = sumGst([...lines, ...fees]);
  const discount = add(...lines.map((line) => line.discount));
  const feeTotal = add(...fees.map((fee) => fee.gross));

  return { ...totals, lines, fees, listed, discount, feeTotal };
}

export interface Margin {
  /** Net of tax. What the business actually earns. */
  readonly netRevenue: Paise;
  readonly cost: Paise;
  /** netRevenue − cost. */
  readonly contribution: Paise;
  /** Contribution as a share of net revenue. */
  readonly marginBps: Bps;
  /** Cost as a share of net revenue — the food cost percentage. */
  readonly foodCostBps: Bps;
}

/**
 * Margin on net-of-tax revenue.
 *
 * Deliberately takes `netRevenue` rather than a listed price, so there is no
 * way to compute a margin without having gone through `priceLine` first and
 * therefore no way to accidentally compute it on a tax-inclusive figure. That
 * mistake overstates revenue by the tax rate and flatters every margin on the
 * dashboard.
 */
export function margin({ netRevenue, cost }: { netRevenue: Paise; cost: Paise }): Margin {
  const contribution = subtract(netRevenue, cost);

  return {
    netRevenue,
    cost,
    contribution,
    marginBps: ratioBps(contribution, netRevenue),
    foodCostBps: ratioBps(cost, netRevenue),
  };
}

/**
 * Margin on a single product at its listed price.
 *
 * Prices the line first and takes margin from its `taxable` value, so the
 * result moves with the organization's GST basis without the caller having to
 * think about it.
 */
export function productMargin(
  {
    listedPrice,
    rateBps,
    cost,
    quantity = 1,
  }: {
    listedPrice: Paise;
    rateBps: Bps;
    cost: Paise;
    quantity?: number;
  },
  context: PricingContext,
): Margin & { readonly priced: PricedLine } {
  const priced = priceLine({ unitPrice: listedPrice, quantity, rateBps }, context);

  return {
    ...margin({ netRevenue: priced.taxable, cost: multiply(cost, quantity) }),
    priced,
  };
}

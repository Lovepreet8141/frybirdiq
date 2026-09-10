/**
 * Where an order came from. BUILD-PLAN.md §43.
 *
 * §43 lists a single `DELIVERY_PARTNER` value. That is not enough here.
 * Swiggy and Zomato charge materially different commissions, and the gap
 * between a ₹300 dine-in order and a ₹300 aggregator order after commission
 * is the single most important number this business has. Collapsing them into
 * one value would make channel margin unanswerable, and adding the split later
 * would mean migrating every order row ever written.
 */

export const ORDER_SOURCES = [
  "WEBSITE",
  "POS",
  "PHONE",
  "KIOSK",
  "SWIGGY",
  "ZOMATO",
  "IMPORT",
] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Sources where a third party owns the customer and takes a cut. */
export const AGGREGATOR_SOURCES = ["SWIGGY", "ZOMATO"] as const;
export type AggregatorSource = (typeof AGGREGATOR_SOURCES)[number];

export function isAggregator(source: OrderSource): source is AggregatorSource {
  return (AGGREGATOR_SOURCES as readonly OrderSource[]).includes(source);
}

/**
 * Whether FRYBIRD owns the customer relationship for this order.
 *
 * Direct-order share is the metric the whole platform exists to move — §75
 * calls owning the customer experience the first differentiator.
 */
export function isDirect(source: OrderSource): boolean {
  return !isAggregator(source) && source !== "IMPORT";
}

export const ORDER_SOURCE_LABELS: Readonly<Record<OrderSource, string>> = {
  WEBSITE: "Website",
  POS: "Counter",
  PHONE: "Phone",
  KIOSK: "Kiosk",
  SWIGGY: "Swiggy",
  ZOMATO: "Zomato",
  IMPORT: "Imported",
};

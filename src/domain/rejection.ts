/**
 * Why an order gets turned down.
 *
 * A fixed list rather than free text, because the point of recording it is to
 * count it later: "outside the delivery area" four times this week is a radius
 * problem, "sold out" four times is a prep problem, and free text answers
 * neither question.
 *
 * `OTHER` carries a note, for the case the list does not cover.
 */

export const REJECTION_REASONS = [
  "SOLD_OUT",
  "TOO_BUSY",
  "CLOSING",
  "OUT_OF_AREA",
  "CUSTOMER_CANCELLED",
  "DUPLICATE",
  "OTHER",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_LABELS: Readonly<Record<RejectionReason, string>> = {
  SOLD_OUT: "Sold out",
  TOO_BUSY: "Too busy right now",
  CLOSING: "We're closing",
  OUT_OF_AREA: "Too far to deliver",
  CUSTOMER_CANCELLED: "Customer cancelled",
  DUPLICATE: "Duplicate order",
  OTHER: "Something else",
};

/** What the customer is told. Never the internal label. */
export const REJECTION_MESSAGE: Readonly<Record<RejectionReason, string>> = {
  SOLD_OUT: "Sorry — we've sold out of something in this order.",
  TOO_BUSY: "Sorry — the kitchen is too busy to take this right now.",
  CLOSING: "Sorry — we're closing and can't cook this.",
  OUT_OF_AREA: "Sorry — this address is too far for us to deliver to.",
  CUSTOMER_CANCELLED: "This order was cancelled.",
  DUPLICATE: "This looked like a duplicate order and was cancelled.",
  OTHER: "Sorry — we couldn't take this order.",
};

export function isRejectionReason(value: unknown): value is RejectionReason {
  return typeof value === "string" && (REJECTION_REASONS as readonly string[]).includes(value);
}

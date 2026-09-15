/**
 * Waste reasons — shown to whoever records waste and to whoever reads it
 * back later. Roadmap 3.3.
 *
 * Deliberately not derived from `wasteReasonEnum` in `db/schema/inventory.ts`:
 * that schema module pulls in `drizzle-orm/pg-core`, which has no business in
 * a client bundle, and this file is imported by the client-side waste form
 * (`waste-form.tsx`). Keep this list in sync with the enum by hand — it is
 * exactly the seven values `wasteReasonEnum` defines. The Server Action
 * (`waste-actions.ts`) validates against the real schema enum, not this one,
 * so a drift here would be caught as a rejected value rather than a silently
 * accepted wrong one.
 */
export const WASTE_REASONS = [
  "EXPIRED",
  "OVERPRODUCTION",
  "PREPARATION",
  "DAMAGED",
  "CUSTOMER_RETURN",
  "QUALITY",
  "CANCELLED_ORDER",
] as const;

export type WasteReasonOption = (typeof WASTE_REASONS)[number];

export const WASTE_REASON_LABEL: Record<WasteReasonOption, string> = {
  EXPIRED: "Expired",
  OVERPRODUCTION: "Overproduction",
  PREPARATION: "Prep loss",
  DAMAGED: "Damaged",
  CUSTOMER_RETURN: "Customer return",
  QUALITY: "Quality reject",
  CANCELLED_ORDER: "Cancelled order",
};

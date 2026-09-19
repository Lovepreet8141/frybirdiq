/**
 * What the customer is told, and what they may press, for each ordering state.
 *
 * Input is `ShopOrderingState` — the one answer `getOrderingStatus` returns
 * (ops-1 RULE 1: nothing here reads the organization columns, so a pause that
 * did not take shows as not paused). Pure: no database, no clock; the words are
 * the owner's (board.md, ops-1 owner requirements 2), and a time is only ever
 * the finished `reopensAtLabel` the status already carries.
 */

import type { ShopOrderingState } from "./shop-hours";

export interface OrderingBannerCopy {
  readonly kind: "closed" | "paused";
  readonly headline: string;
  /** The "when" line; null never happens for closed/paused today, but the type does not promise it. */
  readonly detail: string | null;
  /** The owner's public note for a planned closure ("Closed for Diwali"), shown as plain text under the detail. Null when there is none. */
  readonly note: string | null;
}

/** Null while open: nothing is rendered at all. */
export function orderingBanner(state: ShopOrderingState): OrderingBannerCopy | null {
  switch (state.state) {
    case "open":
      return null;
    case "closedByHours":
      // A whole closed day (weekly off day or planned closure) says so; the clock closing does not.
      return state.dayOff
        ? { kind: "closed", headline: "We're closed today.", detail: `We open again ${state.reopensAtLabel}.`, note: state.dayOff.note }
        : { kind: "closed", headline: "We're closed right now.", detail: `We open ${state.reopensAtLabel}.`, note: null };
    case "paused":
      return {
        kind: "paused",
        headline: "We're not taking orders right now.",
        detail: state.reopensAtLabel ? `We open again ${state.reopensAtLabel}.` : "Please check back soon.",
        note: null,
      };
  }
}

export interface OrderingControls {
  /** May the customer add to the cart and check out at all. */
  readonly canOrder: boolean;
  /** "As soon as possible" is offered only while open. */
  readonly asapAllowed: boolean;
  /** "Choose a time" is offered while open and while closed by hours — never while paused. */
  readonly preorderAllowed: boolean;
  /** The short reason on a disabled control; null when enabled. */
  readonly disabledReason: string | null;
}

export function orderingControls(state: ShopOrderingState | null): OrderingControls {
  // No status (the shop row could not be read) does not disable ordering: the
  // server gate is the authority and will refuse if it must.
  if (!state || state.state === "open") return { canOrder: true, asapAllowed: true, preorderAllowed: true, disabledReason: null };
  if (state.state === "closedByHours") return { canOrder: true, asapAllowed: false, preorderAllowed: true, disabledReason: null };
  return { canOrder: false, asapAllowed: false, preorderAllowed: false, disabledReason: "Ordering is paused right now." };
}

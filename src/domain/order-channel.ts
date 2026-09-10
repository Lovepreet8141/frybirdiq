/**
 * Where an order came from. Direct orders only.
 *
 * FRYBIRD sells dine-in, over the counter, and through its own website. There
 * are no aggregators in this build — no Swiggy, no Zomato, no commission, no
 * settlement reconciliation. BUILD-PLAN.md §43 and §75 assume a delivery
 * partner exists; this build deliberately does not, and §75's first
 * differentiator — the restaurant owning its own customer — is the whole
 * point rather than one option among several.
 *
 * If an aggregator is ever added, it comes back as a new channel value plus a
 * commission model, and every revenue figure has to be revisited. It does not
 * come back by quietly widening this enum.
 */

import type { FulfilmentType } from "./order-status";

export const ORDER_CHANNELS = ["DINE_IN", "TAKEAWAY", "ONLINE"] as const;

export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_CHANNEL_LABELS: Readonly<Record<OrderChannel, string>> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  ONLINE: "Online",
};

/**
 * Which fulfilment types each channel allows.
 *
 * Channel and fulfilment answer different questions — channel is where the
 * order came from, fulfilment is how it gets handed over — but they are not
 * independent, and two of the three channels fully determine it.
 *
 * Only ONLINE is genuinely free: a website order can be collected or
 * delivered. That is why `fulfilment` survives as its own column rather than
 * collapsing into this one; the order state machine gates OUT_FOR_DELIVERY on
 * it, and an online order that is being collected must never enter that state.
 */
const ALLOWED_FULFILMENTS: Readonly<Record<OrderChannel, readonly FulfilmentType[]>> = {
  DINE_IN: ["DINE_IN"],
  TAKEAWAY: ["TAKEAWAY"],
  ONLINE: ["TAKEAWAY", "DELIVERY"],
};

export function fulfilmentsFor(channel: OrderChannel): readonly FulfilmentType[] {
  return ALLOWED_FULFILMENTS[channel];
}

export function isFulfilmentValid(channel: OrderChannel, fulfilment: FulfilmentType): boolean {
  return ALLOWED_FULFILMENTS[channel].includes(fulfilment);
}

export class InvalidChannelFulfilment extends Error {
  constructor(
    readonly channel: OrderChannel,
    readonly fulfilment: FulfilmentType,
  ) {
    super(`order: a ${channel} order cannot be fulfilled as ${fulfilment}`);
    this.name = "InvalidChannelFulfilment";
  }
}

/**
 * Throws unless the pair is coherent.
 *
 * Mirrored by a check constraint on `orders`, so a bad pair cannot reach the
 * database even if a service forgets to call this. The two must stay in step.
 */
export function assertChannelFulfilment(channel: OrderChannel, fulfilment: FulfilmentType): void {
  if (!isFulfilmentValid(channel, fulfilment)) {
    throw new InvalidChannelFulfilment(channel, fulfilment);
  }
}

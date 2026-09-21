import type { Paise } from "@/lib/money";

/**
 * What a rider sees of a delivery nobody has taken yet ("Available"): the pickup-level facts needed to decide
 * whether to take it, and NOTHING about the customer or where they live. No name, phone, address, landmark or
 * coordinates until the rider has taken it (rider-offer, owner decision 2026-09-21). The mapper is an
 * allow-list: a field added to the order view later never reaches an offer unless it is added here on purpose.
 */
export interface DeliveryOffer {
  readonly id: string;
  readonly orderNumber: string;
  /** How many items to pick up, counting quantities. */
  readonly itemCount: number;
  /** What the order comes to, so the rider knows what to collect. */
  readonly grandTotal: Paise;
  /** Already paid: no cash to collect. */
  readonly isPaid: boolean;
  /** How far the drop is, as measured when it was placed; null when it was not measured. Never the address. */
  readonly distanceMetres: number | null;
  /** When the order was placed, so the rider can see how long it has been waiting. */
  readonly placedAt: Date | null;
}

export const OFFER_KEYS = ["id", "orderNumber", "itemCount", "grandTotal", "isPaid", "distanceMetres", "placedAt"] as const;

export function toOffer(order: {
  readonly id: string;
  readonly orderNumber: string;
  readonly grandTotal: Paise;
  readonly isPaid: boolean;
  readonly placedAt: Date | null;
  readonly items: readonly { readonly quantity: number }[];
  readonly delivery: { readonly distanceMetres: number | null } | null;
}): DeliveryOffer {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    grandTotal: order.grandTotal,
    isPaid: order.isPaid,
    distanceMetres: order.delivery?.distanceMetres ?? null,
    placedAt: order.placedAt,
  };
}

import "server-only";

import { viewerOwnsOrder } from "@/components/order/viewer-owns-order";
import { readRememberedContact } from "@/lib/cart/remembered-contact";
import { getCustomer } from "@/lib/customer";
import { getOrder } from "@/lib/repositories/orders";
import { getOrg } from "@/lib/repositories/org";
import { getRiderTrackingView } from "@/lib/repositories/rider-tracking";
import { isUuid } from "@/lib/uuid";

export interface RiderViewBody {
  readonly state: "hidden" | "waiting" | "stale" | "live";
  readonly ageSeconds: number | null;
  readonly rider: { readonly lat: number; readonly lng: number; readonly at: string } | null;
  readonly destination: { readonly lat: number; readonly lng: number } | null;
  readonly shop: { readonly lat: number; readonly lng: number } | null;
}

/**
 * What the current visitor may be told about this order's rider (Lane B), or null when they may be told nothing.
 *
 * The order link is an unguessable UUID but it gets shared, so knowing it is not enough: only the person who placed the order
 * (`viewerOwnsOrder`: their signed-in phone or email, or the signed contact cookie this browser holds) gets an answer.
 * A stranger, an unknown id and a malformed id are all the same null. The answer is the newest fix only, only while the order is
 * out for delivery; before and after that the state is "hidden" and no coordinates leave the server.
 */
export async function riderViewForViewer(orderId: string): Promise<RiderViewBody | null> {
  if (!isUuid(orderId)) return null;
  const [order, customer, remembered, org] = await Promise.all([getOrder(orderId), getCustomer(), readRememberedContact(), getOrg()]);
  if (!order || !org || !viewerOwnsOrder(order, customer, remembered)) return null;

  const view = await getRiderTrackingView({ orgId: org.id, orderId: order.id });
  return {
    state: view.state.kind,
    ageSeconds: "ageSeconds" in view.state ? view.state.ageSeconds : null,
    rider: view.rider ? { lat: view.rider.lat, lng: view.rider.lng, at: view.rider.recordedAt.toISOString() } : null,
    destination: view.destination,
    shop: view.shop,
  };
}

"use client";

import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";

/**
 * Keeps every Close Shop control on one screen showing the same thing.
 *
 * The POS has the header switch AND the top-bar pill; both are views of the one
 * server read. After either gets an answer from the server (a switch, a poll)
 * it publishes it here and the other adopts it at once, in the same tab. Other
 * tabs and screens converge by their own 60 s poll of the same read. This is a
 * relay of what the SERVER said, never of a click: there is no second source of
 * truth and nothing optimistic.
 */
const EVENT = "frybird:shop-status";

export function publishShopStatus(status: StaffOrderingStatus): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StaffOrderingStatus>(EVENT, { detail: status }));
}

export function subscribeShopStatus(listener: (status: StaffOrderingStatus) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<StaffOrderingStatus>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

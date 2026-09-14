"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOrderBroadcast } from "@/lib/realtime/client";

/** While an order is still moving, the page refreshes itself this often even if the socket is quiet. */
const FALLBACK_MS = 30_000;

/**
 * Keeps the customer's tracking page current. Roadmap 2.3.
 *
 * Listens on the order's own broadcast topic (migration 0027) and re-runs
 * the page when the kitchen moves it — the same server render, the same
 * data, no second path. Once the order is finished there is nothing left to
 * hear, so the component renders nothing and opens no socket.
 */
export function OrderLive({ orderId, active }: { orderId: string; active: boolean }) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      router.refresh();
    }, 300);
  };

  useOrderBroadcast(orderId, refresh, active);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, FALLBACK_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/components/pos/use-online";
import { useOrderEvents } from "@/lib/realtime/client";

/** Fallback poll for a dropped socket. Slow on purpose: the channel does the real work. */
export const FALLBACK_MS = 60_000;

/**
 * Re-renders a server page when an order event lands, and on a slow fallback.
 *
 * `router.refresh()` re-runs the page under its own permission gate and its
 * own repository calls — so a "live" screen needs no second data path and
 * no new server action that could expose anything the page itself doesn't.
 * Events are coalesced: a burst of status changes in the same second is one
 * refresh. Paused while offline or while the tab is hidden.
 */
export function LiveRefresh({ orgId, fallbackMs = FALLBACK_MS }: { orgId: string; fallbackMs?: number }) {
  const router = useRouter();
  const online = useOnline();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      if (document.visibilityState === "visible") router.refresh();
    }, 400);
  };

  useOrderEvents(orgId, refresh, online);

  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, fallbackMs);
    return () => clearInterval(timer);
  }, [router, online, fallbackMs]);

  return null;
}

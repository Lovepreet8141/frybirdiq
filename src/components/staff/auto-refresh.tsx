"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOnline } from "@/components/pos/use-online";

/**
 * Re-renders a server page on an interval, nothing more.
 *
 * `router.refresh()` re-runs the page under its own permission gate and its
 * own repository calls — so a "live" screen needs no second data path and
 * no new server action that could expose anything the page itself doesn't.
 * Paused while offline or while the tab is hidden: a screen nobody is
 * looking at should not cost the counter's connection anything.
 */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  const online = useOnline();

  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, online, everyMs]);

  return null;
}

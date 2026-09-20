"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnline } from "@/components/pos/use-online";
import { STALE_DEPLOYMENT_MESSAGE, isStaleDeploymentError } from "@/lib/errors/stale-deployment";
import { pollStationOrders } from "@/lib/kitchen/stations-action";
import type { StationOrder } from "@/lib/kitchen/stations";
import { useOrderEvents } from "@/lib/realtime/client";

/** Line marks do not emit order events, so the station screens poll briskly: a station's "done" reaches EXPO within this. */
const POLL_MS = 10_000;
const CLOCK_MS = 30_000;

/** Live station orders: realtime for status changes, a short poll for line marks, and honest error / offline / stale-build states. */
export function useStationOrders(initial: readonly StationOrder[], orgId: string) {
  const [orders, setOrders] = useState<readonly StationOrder[]>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [staleDeployment, setStaleDeployment] = useState(false);
  const online = useOnline();
  const stopped = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const result = await pollStationOrders();
      if (stopped.current) return;
      setOrders(result.orders);
      setNow(Date.now());
      setError(null);
    } catch (thrown) {
      if (stopped.current) return;
      if (isStaleDeploymentError(thrown)) setStaleDeployment(true);
      else setError("The kitchen screen could not refresh. It will try again.");
    }
  }, []);

  useOrderEvents(orgId, () => void refresh(), online);

  useEffect(() => {
    if (!online) return;
    stopped.current = false;
    const poll = setInterval(() => void refresh(), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      stopped.current = true;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [online, refresh]);

  return { orders, now, error, staleDeployment, staleMessage: STALE_DEPLOYMENT_MESSAGE, online, refresh, setOrders };
}

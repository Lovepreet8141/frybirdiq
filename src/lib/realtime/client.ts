"use client";

/**
 * Realtime, from the browser. Roadmap Phase 2.
 *
 * One channel per screen, opened with the signed-in session's own token so
 * row-level security decides what arrives — a staff member sees their
 * organization's order events and nothing else. The customer's tracking
 * page listens on a public broadcast topic named by its order id (see
 * migration 0027). Every subscriber keeps a slow fallback poll of its own:
 * a dropped socket must degrade to "a minute late", never to "silent".
 */

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

export interface OrderEventRow {
  readonly id: string;
  readonly org_id: string;
  readonly order_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly actor_user_id: string | null;
  readonly reason: string | null;
  readonly created_at: string;
}

/** "off" until the channel reports SUBSCRIBED; a consumer keeps its fallback poll regardless. */
export type LiveStatus = "off" | "live" | "error";

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

let subscriberSeq = 0;

/**
 * A channel name no other subscriber on this page shares.
 *
 * `supabase.channel(name)` hands back the existing channel when the name
 * matches, and a channel that has already joined throws on the next `.on()`.
 * Two screens listening to the same organization — the new-order alert in
 * the chrome and the orders board under it — must therefore each own a
 * channel; the topic on the wire is what they have in common, not the name.
 */
export function uniqueChannelName(base: string, seq: number): string {
  return `${base}:s${seq}`;
}

function useChannelName(base: string | null): string | null {
  const [seq] = useState(() => ++subscriberSeq);
  return base ? uniqueChannelName(base, seq) : null;
}

/** Staff: every new order_events row for the organization, as it lands. */
export function useOrderEvents(orgId: string | null, onEvent: (event: OrderEventRow) => void, enabled = true): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("off");
  const handler = useLatest(onEvent);
  const name = useChannelName(orgId ? `orders:${orgId}` : null);

  useEffect(() => {
    if (!enabled || !orgId || !name || !isSupabaseConfigured()) return;
    const supabase = createClient();
    const channel: RealtimeChannel = supabase
      .channel(name)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_events", filter: `org_id=eq.${orgId}` }, (payload) => {
        handler.current(payload.new as OrderEventRow);
      })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setStatus("live");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("error");
        else if (state === "CLOSED") setStatus("off");
      });
    return () => {
      void supabase.removeChannel(channel);
      setStatus("off");
    };
  }, [orgId, name, enabled, handler]);

  return status;
}

/** Staff (POS): a product or its availability changed somewhere in the organization. */
export function useMenuChanges(orgId: string | null, onChange: () => void, enabled = true): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("off");
  const handler = useLatest(onChange);
  const name = useChannelName(orgId ? `menu:${orgId}` : null);

  useEffect(() => {
    if (!enabled || !orgId || !name || !isSupabaseConfigured()) return;
    const supabase = createClient();
    const channel = supabase
      .channel(name)
      .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `org_id=eq.${orgId}` }, () => handler.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "product_availability", filter: `org_id=eq.${orgId}` }, () => handler.current())
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setStatus("live");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("error");
        else if (state === "CLOSED") setStatus("off");
      });
    return () => {
      void supabase.removeChannel(channel);
      setStatus("off");
    };
  }, [orgId, name, enabled, handler]);

  return status;
}

/** Customer: the status broadcast for one order, on its public topic. */
export function useOrderBroadcast(orderId: string | null, onStatus: (event: { orderId: string; toStatus: string; at: string }) => void, enabled = true): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("off");
  const handler = useLatest(onStatus);

  useEffect(() => {
    if (!enabled || !orderId || !isSupabaseConfigured()) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`order:${orderId}`, { config: { private: false } })
      .on("broadcast", { event: "status" }, (message) => {
        const payload = (message.payload ?? {}) as { orderId?: string; toStatus?: string; at?: string };
        if (payload.orderId && payload.toStatus) handler.current({ orderId: payload.orderId, toStatus: payload.toStatus, at: payload.at ?? new Date().toISOString() });
      })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setStatus("live");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("error");
        else if (state === "CLOSED") setStatus("off");
      });
    return () => {
      void supabase.removeChannel(channel);
      setStatus("off");
    };
  }, [orderId, enabled, handler]);

  return status;
}

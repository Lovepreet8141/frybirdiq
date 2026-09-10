"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, X } from "lucide-react";
import { type NewOrder, pollNewOrders } from "@/lib/auth/order-alert-action";

const POLL_MS = 12_000;
/** How long an unacknowledged order keeps shouting. */
const ALERT_MS = 3 * 60 * 1000;
/** Gap between chimes while it is still unacknowledged. */
const CHIME_MS = 20_000;

/**
 * Tells the counter an order has arrived, and keeps telling them.
 *
 * A single chime at the moment an order lands is no use in a kitchen: whoever
 * was meant to hear it was at the fryer. So the alert repeats for three
 * minutes or until someone acknowledges it, which is the point — an order that
 * nobody has seen is worse than one nobody has cooked.
 *
 * Sound is a generated tone rather than an audio file: nothing to load, works
 * offline, and cannot 404 on a shop's connection.
 */
export function NewOrderAlert() {
  const router = useRouter();
  const [pending, setPending] = useState<NewOrder[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const [blocked, setBlocked] = useState(false);

  const since = useRef(new Date().toISOString());
  const seen = useRef(new Set<string>());
  const firstAt = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);

  const chime = useCallback(() => {
    if (!soundOn) return;
    try {
      // Created lazily: browsers refuse an AudioContext until the page has been
      // interacted with, and creating one on load just logs a warning.
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
        setBlocked(true);
        return;
      }
      setBlocked(false);

      // Two short rising notes — audible across a kitchen, and short enough not
      // to become the thing everyone wants switched off.
      [0, 0.18].forEach((offset, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = index === 0 ? 880 : 1180;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.18);
      });
    } catch {
      // No audio available. The banner still does its job.
      setBlocked(true);
    }
  }, [soundOn]);

  // Poll.
  useEffect(() => {
    let stopped = false;

    const tick = async () => {
      const result = await pollNewOrders({ since: since.current });
      if (stopped) return;
      since.current = result.checkedAt;

      const fresh = result.orders.filter((order) => !seen.current.has(order.id));
      if (fresh.length > 0) {
        for (const order of fresh) seen.current.add(order.id);
        setPending((current) => [...fresh, ...current]);
        firstAt.current ??= Date.now();
        chime();
        // Bring the list itself up to date, not just the banner.
        router.refresh();
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [chime, router]);

  // Keep chiming, and give up after three minutes so it never becomes noise
  // nobody can stop.
  useEffect(() => {
    if (pending.length === 0) return;

    const timer = setInterval(() => {
      if (firstAt.current && Date.now() - firstAt.current > ALERT_MS) {
        setPending([]);
        firstAt.current = null;
        return;
      }
      chime();
    }, CHIME_MS);

    return () => clearInterval(timer);
  }, [pending.length, chime]);

  function acknowledge() {
    setPending([]);
    firstAt.current = null;
  }

  if (pending.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-30 border-b-2 border-primary bg-primary text-primary-foreground"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-[var(--gutter)] py-3">
        <div className="flex items-center gap-3">
          <Bell className="size-5 shrink-0 animate-pulse" aria-hidden="true" />
          <p className="font-heading text-lg font-bold">
            {pending.length === 1
              ? `New order #${pending[0]!.orderNumber}`
              : `${pending.length} new orders`}
            <span className="ml-2 text-sm font-medium opacity-90">
              {pending.length === 1
                ? `${pending[0]!.fulfilment === "DELIVERY" ? "Delivery" : "Collection"} · ${pending[0]!.total}`
                : pending.map((order) => `#${order.orderNumber}`).join(" ")}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundOn((on) => !on)}
            className="flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm font-semibold underline-offset-4 hover:underline"
            aria-pressed={soundOn}
          >
            {soundOn ? <Bell className="size-4" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
            {soundOn ? "Sound on" : "Sound off"}
          </button>

          <button
            type="button"
            onClick={acknowledge}
            className="flex min-h-[44px] items-center gap-2 rounded-md border-2 border-current px-4 text-sm font-bold"
          >
            <X className="size-4" aria-hidden="true" />
            Got it
          </button>
        </div>
      </div>

      {/* Said plainly rather than failing silently: a chime nobody can hear is
          the one failure this component must not have. */}
      {blocked && soundOn && (
        <p className="mx-auto w-full max-w-6xl px-[var(--gutter)] pb-2 text-xs opacity-90">
          Tap anywhere on this page once to allow sound.
        </p>
      )}
    </div>
  );
}

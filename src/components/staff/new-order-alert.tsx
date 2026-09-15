"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Bike, Check, Clock, Loader2, Store, X } from "lucide-react";
import { type NewOrder, pollNewOrders } from "@/lib/auth/order-alert-action";
import { acceptOrderAction, rejectOrderAction } from "@/lib/auth/staff-actions";
import { REJECTION_LABELS, REJECTION_REASONS, type RejectionReason } from "@/domain/rejection";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, isStaleDeploymentError } from "@/lib/errors/stale-deployment";
import { openKotWindow } from "./print-kot";
import { useChime } from "./use-chime";
import { useOrderEvents } from "@/lib/realtime/client";
import { cn } from "@/lib/utils";

/** Fallback only: the order_events channel prompts a check the moment an order lands (roadmap 2.4); this catches a dropped socket. */
const POLL_MS = 60_000;
/**
 * Gap between bursts while an order is in front of someone.
 *
 * Short enough to be a nuisance, which is the point: it stops the moment the
 * order is dealt with, and every second it keeps going is a second a customer
 * is waiting on a kitchen that has not looked up.
 */
const URGENT_MS = 1_800;
/** Slower once it has been deferred — still nagging, no longer shouting. */
const DEFERRED_MS = 8_000;

/**
 * Puts a new order in front of whoever is at the counter, and keeps it there.
 *
 * A pop-up rather than a banner, because an order needs a decision — accepted
 * and cooked, or turned down so the customer stops waiting. A notification
 * that can be scrolled past is one that gets scrolled past during a rush.
 *
 * It does not close on Escape or on a click outside. Both are how a dialog is
 * dismissed by accident, and an order dismissed by accident is an order nobody
 * ever cooks. "Later" is there for when the counter genuinely cannot deal with
 * it yet — it drops to a persistent banner rather than disappearing.
 */
export function NewOrderAlert({ canReject, orgId }: { canReject: boolean; orgId: string }) {
  const router = useRouter();
  const { play, ready: soundReady } = useChime();
  const tickRef = useRef<(() => Promise<void>) | null>(null);

  // Realtime: an order event re-runs the same permission-checked poll at
  // once, so the chime fires within a second or two of placement.
  useOrderEvents(orgId, () => void tickRef.current?.());

  const [queue, setQueue] = useState<NewOrder[]>([]);
  const [deferred, setDeferred] = useState<NewOrder[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectionReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when a poll fails because this tab predates the last deploy — see
   * `src/lib/errors/stale-deployment.ts`. Unlike a form, a background poll
   * has nobody watching for an inline error message, so silently swallowing
   * this would mean a genuinely dangerous failure mode: new orders stop
   * arriving here and nothing says why until someone happens to reload.
   * Shown as a banner that outranks everything else on screen, and once
   * true the poll stops retrying — every following attempt would fail the
   * same way, for the same reason, until a reload fetches the current build.
   */
  const [staleDeployment, setStaleDeployment] = useState(false);
  /*
   * How long the kitchen says it will take.
   *
   * Offered as a few realistic choices rather than a free number: during a
   * rush nobody types, and a list of taps is faster than a spinner. Twenty is
   * preselected so the common case is one press, and whatever is chosen is
   * what the customer is told — nothing here invents a time on the kitchen's
   * behalf.
   */
  const [prepMinutes, setPrepMinutes] = useState(20);

  /** Orders the counter pressed Later on. Kept out of the dialog, not lost. */
  const seen = useRef(new Set<string>());
  const acceptRef = useRef<HTMLButtonElement>(null);

  const current = queue[0] ?? null;

  const chime = useCallback(() => {
    if (soundOn) play();
  }, [soundOn, play]);

  // Poll for arrivals.
  useEffect(() => {
    let stopped = false;

    const tick = async () => {
      let result;
      try {
        result = await pollNewOrders();
      } catch (error) {
        if (!isStaleDeploymentError(error)) throw error;
        if (!stopped) {
          setStaleDeployment(true);
          clearInterval(timer);
        }
        return;
      }
      if (stopped) return;

      // Everything still awaiting a decision, minus anything already in front
      // of us or deferred. Asking the question this way means opening the
      // screen with undecided orders prompts straight away.
      const fresh = result.orders.filter((order) => !seen.current.has(order.id));
      if (fresh.length === 0) return;

      for (const order of fresh) seen.current.add(order.id);
      setQueue((existing) => [...existing, ...fresh]);
      chime();
      router.refresh();
    };

    tickRef.current = tick;
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [chime, router]);

  /*
   * Keep sounding until it is dealt with.
   *
   * Urgently while the dialog is up, more slowly once it has been deferred.
   * Both stop the instant the order is accepted or turned down — an alarm that
   * outlasts the thing it was about is one people learn to ignore.
   */
  useEffect(() => {
    const pending = queue.length > 0;
    if (!pending && deferred.length === 0) return;

    const every = pending ? URGENT_MS : DEFERRED_MS;
    chime();
    const timer = setInterval(chime, every);
    return () => clearInterval(timer);
  }, [queue.length, deferred.length, chime]);

  // Focus the primary action, so a keyboard or a screen reader lands on the
  // decision rather than at the top of the page behind it.
  useEffect(() => {
    if (current && !rejecting) acceptRef.current?.focus();
  }, [current, rejecting]);

  function done() {
    setQueue((existing) => existing.slice(1));
    setRejecting(false);
    setReason(null);
    setNote("");
    setError(null);
    router.refresh();
  }

  async function accept() {
    if (!current) return;
    // Opened here, before the first await — a browser only lets
    // `window.open` through without treating it as a pop-up when it runs in
    // the same tick as the tap that caused it.
    const kot = openKotWindow();
    setBusy(true);
    setError(null);
    const result = await acceptOrderAction({ orderId: current.id, prepMinutes });
    setBusy(false);
    if (!result.ok) {
      kot.cancel();
      return setError(result.error ?? "That didn't work.");
    }
    kot.commit(current.id);
    done();
  }

  async function reject() {
    if (!current || !reason) return;
    setBusy(true);
    setError(null);
    const result = await rejectOrderAction({ orderId: current.id, reason, note: note || undefined });
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "That didn't work.");
    done();
  }

  function later() {
    if (!current) return;
    setDeferred((existing) => [...existing, current]);
    setQueue((existing) => existing.slice(1));
    setRejecting(false);
    setReason(null);
  }

  function reopen() {
    setQueue((existing) => [...deferred, ...existing]);
    setDeferred([]);
  }

  return (
    <>
      {/* Outranks the deferred banner below — a stopped poll means new
          orders may already be waiting and nothing else on this screen
          will say so. */}
      {staleDeployment && (
        <div role="alert" className="sticky top-0 z-40 border-b-2 border-destructive bg-destructive text-destructive-foreground">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-[var(--gutter)] py-3">
            <p className="font-heading text-lg font-bold">{STALE_DEPLOYMENT_MESSAGE} New orders won&apos;t appear here until you do.</p>
            <ReloadAppButton className="!bg-destructive-foreground !text-destructive hover:!opacity-90" />
          </div>
        </div>
      )}

      {/* Deferred orders keep a standing reminder. Nothing is ever lost by
          pressing Later. */}
      {deferred.length > 0 && !current && (
        <div role="status" className="sticky top-0 z-30 border-b-2 border-primary bg-primary text-primary-foreground">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-[var(--gutter)] py-3">
            <p className="flex items-center gap-2 font-heading text-lg font-bold">
              <Bell className="size-5 animate-pulse" aria-hidden="true" />
              {deferred.length} {deferred.length === 1 ? "order needs" : "orders need"} a decision
            </p>
            <button
              type="button"
              onClick={reopen}
              className="flex min-h-[44px] items-center rounded-md border-2 border-current px-4 text-sm font-bold"
            >
              Deal with {deferred.length === 1 ? "it" : "them"}
            </button>
          </div>
        </div>
      )}

      {current && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-order-title"
            className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-panel p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                  New order{queue.length > 1 ? ` · ${queue.length} waiting` : ""}
                </p>
                <h2 id="new-order-title" className="tabular font-heading text-3xl font-bold">
                  #{current.orderNumber}
                </h2>
              </div>
              <span className="tabular font-heading text-2xl font-bold">{current.total}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-y border-border py-3 text-sm">
              <span className="flex items-center gap-1.5 font-semibold">
                {current.fulfilment === "DELIVERY" ? (
                  <>
                    <Bike className="size-4 text-primary" aria-hidden="true" />
                    Delivery
                  </>
                ) : (
                  <>
                    <Store className="size-4 text-primary" aria-hidden="true" />
                    Collection
                  </>
                )}
              </span>
              {current.customerName && <span className="text-muted-foreground">{current.customerName}</span>}
              {current.waitingMinutes > 0 && (
                <span className="tabular ml-auto font-semibold text-destructive">
                  waiting {current.waitingMinutes} min
                </span>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
                {error}
              </p>
            )}

            {rejecting ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold">Why are you turning this down?</legend>

                {REJECTION_REASONS.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex min-h-[48px] cursor-pointer items-center gap-3 rounded-md border px-4 py-2 text-sm transition-colors",
                      reason === option ? "border-primary bg-primary/10" : "border-border hover:border-border-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="rejectionReason"
                      checked={reason === option}
                      onChange={() => setReason(option)}
                      className="size-4 accent-primary"
                    />
                    <span className="font-medium">{REJECTION_LABELS[option]}</span>
                  </label>
                ))}

                {reason === "OTHER" && (
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={200}
                    placeholder=""
                    aria-label="What happened"
                    className="mt-1 h-[48px] rounded-md border border-border bg-surface-muted px-4 text-sm"
                  />
                )}

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={reject}
                    disabled={busy || !reason}
                    className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-md bg-destructive px-4 font-semibold text-destructive-foreground disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <X className="size-4" aria-hidden="true" />}
                    Turn down
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejecting(false)}
                    disabled={busy}
                    className="flex min-h-[56px] items-center justify-center rounded-md border border-border px-4 font-semibold"
                  >
                    Back
                  </button>
                </div>
              </fieldset>
            ) : (
              <div className="flex flex-col gap-3">
                <fieldset>
                  <legend className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <Clock className="size-4 text-primary" aria-hidden="true" />
                    Ready in
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {[10, 15, 20, 30, 45].map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => setPrepMinutes(minutes)}
                        aria-pressed={prepMinutes === minutes}
                        className={cn(
                          "min-h-[48px] flex-1 rounded-md border px-3 text-sm font-semibold transition-colors",
                          prepMinutes === minutes
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-border-strong",
                        )}
                      >
                        {minutes} min
                      </button>
                    ))}
                  </div>
                </fieldset>

                <button
                  ref={acceptRef}
                  type="button"
                  onClick={accept}
                  disabled={busy}
                  className="flex min-h-[64px] items-center justify-center gap-3 rounded-md bg-primary px-6 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Check className="size-5" aria-hidden="true" />}
                  Accept · ready in {prepMinutes} min
                </button>

                <div className="flex gap-2">
                  {/* Hidden for anyone without the permission — a button that
                      always fails is worse than no button. The action checks
                      again server-side regardless. */}
                  {canReject && (
                    <button
                      type="button"
                      onClick={() => setRejecting(true)}
                      disabled={busy}
                      className="flex min-h-[48px] flex-1 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted"
                    >
                      Turn down
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={later}
                    disabled={busy}
                    className="flex min-h-[48px] flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-muted"
                  >
                    Later
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setSoundOn((on) => !on)}
                aria-pressed={soundOn}
                className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground"
              >
                {soundOn ? <Bell className="size-4" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
                {soundOn ? "Sound on" : "Sound off"}
              </button>

              {soundOn && (
                soundReady ? (
                  <button
                    type="button"
                    onClick={play}
                    className="flex min-h-[44px] items-center rounded-md border border-border px-3 text-sm font-semibold"
                  >
                    Test
                  </button>
                ) : (
                  /* Said plainly rather than failing silently. */
                  <p className="text-xs text-muted-foreground">Tap anywhere once to allow sound</p>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

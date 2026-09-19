"use client";

import { useState, useTransition } from "react";
import { pauseOrderingAction, resumeOrderingAction } from "@/lib/orders/shop-status-actions";
import type { PauseMode } from "@/lib/orders/opening-hours";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { PAUSE_MODE_LABELS, SHOP_CLOSED_HEADLINE, SHOP_OPEN_HEADLINE } from "@/lib/settings/close-shop-copy";

/**
 * The Close Shop switch on Admin → Restaurant (ops-1 S4b) — the same switch as
 * the POS header, usable on the owner's phone.
 *
 * Reads state only from `status`, which the page took from
 * `getOrderingStatusForStaff` (RULE 1). An action that answers ok never
 * repaints this panel on its own: the page re-renders from the database, so a
 * pause that did not take shows as NOT paused right here.
 *
 * Both actions check `orders.update` on the server; nothing here is
 * authorization. Every control is at least 44px tall.
 */

const control = "inline-flex min-h-11 w-full items-center justify-center rounded-md px-5 text-sm font-semibold transition-colors duration-[120ms] disabled:opacity-60 sm:w-auto";
const primary = `${control} bg-inverse text-inverse-foreground hover:bg-inverse/85`;
const secondary = `${control} border border-border bg-panel hover:bg-surface`;

export interface CloseShopPanelProps {
  readonly status: StaffOrderingStatus;
  /** "Orders restart today at 11:30 AM." — computed on the server, per mode, for the confirm. */
  readonly restartLines: Readonly<Record<PauseMode, string>>;
  /** "today at 7:42 PM" — when the current pause began; null when not paused. */
  readonly pausedSince: string | null;
}

export function CloseShopPanel({ status, restartLines, pausedSince }: CloseShopPanelProps) {
  const [choosing, setChoosing] = useState(false);
  const [mode, setMode] = useState<PauseMode>("UNTIL_NEXT_OPENING");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "note"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const paused = status.state === "paused";
  const open = status.state === "open";

  function run(work: () => Promise<{ ok: boolean; error?: string; changed?: boolean }>, done: () => void) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage({ tone: "error", text: "You're offline. Nothing was changed — check your connection and try again." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) setMessage({ tone: "error", text: result.error ?? "That didn't save. Try again." });
        else done();
      } catch {
        setMessage({ tone: "error", text: "Couldn't reach the server. Nothing was changed — try again." });
      }
    });
  }

  function confirmPause() {
    run(
      async () => {
        const result = await pauseOrderingAction({ reason, mode });
        // Already paused elsewhere: the page now shows the pause in force, not this choice.
        if (result.ok && !result.changed) setMessage({ tone: "note", text: "Orders were already switched off — the pause in force is shown above." });
        return result;
      },
      () => {
        setChoosing(false);
        setReason("");
      },
    );
  }

  function resume() {
    if (!(status.state === "paused")) return;
    const shownPausedAt = status.pausedAt.toISOString();
    run(async () => {
      const result = await resumeOrderingAction({ shownPausedAt });
      if (!result.ok && result.code === "PAUSE_CHANGED") setMessage({ tone: "error", text: `${result.error} The pause now in force is shown above.` });
      return result;
    }, () => undefined);
  }

  const reasonOk = reason.trim().length >= 3;
  const stillDue = status.ordersStillDue;

  return (
    <section aria-labelledby="close-shop-heading" className={`rounded-lg border-l-4 p-4 sm:p-5 ${open ? "border-gain bg-gain-soft/60" : "border-loss bg-loss-soft/60"}`}>
      <h2 id="close-shop-heading" className="text-lg font-bold leading-tight">
        {open ? SHOP_OPEN_HEADLINE : SHOP_CLOSED_HEADLINE}
      </h2>

      {/* Always visible: who, when, when it reopens. */}
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {status.state === "open" && (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd>Taking online orders until {status.closesAt}.</dd>
          </>
        )}
        {status.state === "closedByHours" && (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd>Outside opening hours.</dd>
            <dt className="text-muted-foreground">Reopens</dt>
            <dd>{status.reopensAtLabel}</dd>
          </>
        )}
        {status.state === "paused" && (
          <>
            <dt className="text-muted-foreground">Switched off by</dt>
            <dd>{status.pausedBy ? (status.pausedBy.name ?? "A staff member") : "Unknown"}</dd>
            <dt className="text-muted-foreground">When</dt>
            <dd>{pausedSince}</dd>
            <dt className="text-muted-foreground">Reopens</dt>
            <dd>{status.reopensAtLabel ?? "When someone switches it back on"}</dd>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="break-words">{status.reason ?? "—"}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Orders still to make</dt>
        <dd>{stillDue}</dd>
      </dl>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-md border-l-2 px-4 py-3 text-sm ${message.tone === "error" ? "border-loss bg-loss-soft/60" : "border-gain bg-gain-soft/60"}`}>
          {message.text}
        </p>
      )}

      {paused ? (
        <div className="mt-4">
          <button type="button" onClick={resume} disabled={pending} className={primary}>
            {pending ? "Switching on…" : "Switch orders back on"}
          </button>
        </div>
      ) : !choosing ? (
        <div className="mt-4">
          <button type="button" onClick={() => { setMessage(null); setChoosing(true); }} className={secondary}>
            Switch online orders off…
          </button>
        </div>
      ) : (
        <form
          className="mt-4 grid gap-4 rounded-lg border border-border bg-panel p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reasonOk) confirmPause();
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-semibold">For how long?</legend>
            {(Object.keys(PAUSE_MODE_LABELS) as PauseMode[]).map((value) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm">
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="size-5 shrink-0" />
                <span>{PAUSE_MODE_LABELS[value]}{value === "UNTIL_NEXT_OPENING" ? " (default)" : ""}</span>
              </label>
            ))}
          </fieldset>

          <div className="grid gap-1.5">
            <label htmlFor="close-shop-reason" className="text-[13px] font-semibold">
              Why? <span className="font-normal text-muted-foreground">(required — staff only, customers don&apos;t see it)</span>
            </label>
            <input
              id="close-shop-reason"
              name="reason"
              type="text"
              required
              minLength={3}
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Fryer broken"
              className="h-11 w-full rounded-md border border-border bg-panel px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
          </div>

          <div className="grid gap-1 text-sm" role="note">
            <p className="font-semibold">{restartLines[mode]}</p>
            {stillDue > 0 && (
              <p className="text-muted-foreground">
                {stillDue} {stillDue === 1 ? "order is" : "orders are"} already placed and still to be made. Switching off does not cancel {stillDue === 1 ? "it" : "them"}.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { setChoosing(false); setMessage(null); }} disabled={pending} className={secondary}>
              Keep taking orders
            </button>
            <button type="submit" disabled={pending || !reasonOk} className={primary}>
              {pending ? "Switching off…" : "Switch orders off"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

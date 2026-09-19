"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { pauseOrderingAction, previewPauseAction, resumeOrderingAction } from "@/lib/orders/shop-status-actions";
import type { PauseMode } from "@/lib/orders/opening-hours";
import { PAUSE_MODE_OPTIONS, untilDateBounds } from "@/lib/orders/pause-duration";
import { CONFIRM_ARM_MS, confirmArmed } from "@/lib/orders/shop-pill";
import { PAUSE_NOTE_MAX, PAUSE_REASON_PRESETS, type PauseReasonPreset, composePauseReason, noteProblem, pauseRequest } from "@/lib/orders/pause-reasons";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { PAUSE_MODE_LABELS, SHOP_CLOSED_HEADLINE, SHOP_OPEN_HEADLINE, pauseOutcome, restartLine, stillDueLine } from "@/lib/settings/close-shop-copy";

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
  /** "today at 7:42 PM" — when the current pause began; null when not paused. */
  readonly pausedSince: string | null;
}

function toPreview(p: { nextOpeningLabel: string; restOfTodayLabel: string; untilDate: { label: string } | null; ordersStillDue: number }) {
  return { nextOpeningLabel: p.nextOpeningLabel, restOfTodayLabel: p.restOfTodayLabel, untilDateLabel: p.untilDate?.label ?? null, ordersStillDue: p.ordersStillDue };
}

export function CloseShopPanel({ status, pausedSince }: CloseShopPanelProps) {
  const [choosing, setChoosing] = useState(false);
  // Switching back on is two deliberate steps, like the POS: a double-tap must never lift a pause.
  const [confirmingResume, setConfirmingResume] = useState(false);
  const [resumeArmed, setResumeArmed] = useState(false);
  const resumeShownAt = useRef<number | null>(null);
  const [armEpoch, setArmEpoch] = useState(0);
  const [mode, setMode] = useState<PauseMode>("UNTIL_NEXT_OPENING");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "note"; text: string } | null>(null);
  // Read from the server when the chooser opens, not at page render (a phone left open across opening time).
  const [preview, setPreview] = useState<{ nextOpeningLabel: string; restOfTodayLabel: string; untilDateLabel: string | null; ordersStillDue: number } | null>(null);
  const [untilDate, setUntilDate] = useState("");
  const [pending, startTransition] = useTransition();

  const paused = status.state === "paused";
  const open = status.state === "open";

  function run<R extends { ok: boolean; error?: string }>(work: () => Promise<R>, done: (result: R) => void) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage({ tone: "error", text: "You're offline. Nothing was changed — check your connection and try again." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) setMessage({ tone: "error", text: result.error ?? "That didn't save. Try again." });
        else done(result);
      } catch {
        setMessage({ tone: "error", text: "Couldn't reach the server. Nothing was changed — try again." });
      }
    });
  }

  function openChooser() {
    setMessage(null);
    setMode("UNTIL_NEXT_OPENING");
    setNote("");
    setUntilDate("");
    setPreview(null);
    setChoosing(true);
    run(
      () => previewPauseAction(),
      (result) => {
        if ("preview" in result) setPreview(toPreview(result.preview));
      },
    );
  }

  function chooseUntilDate(date: string) {
    setUntilDate(date);
    if (!date) return;
    run(
      () => previewPauseAction({ untilDate: date }),
      (result) => {
        if ("preview" in result) setPreview(toPreview(result.preview));
      },
    );
  }

  /** The second tap: choosing a reason closes the shop. The note is optional. */
  function confirmPause(preset: PauseReasonPreset) {
    const problem = noteProblem(note);
    if (problem) {
      setMessage({ tone: "error", text: problem });
      return;
    }
    if (mode === "UNTIL_DATE" && !untilDate) {
      setMessage({ tone: "error", text: "Pick the date orders should restart." });
      return;
    }
    const chosen = { mode, reason: composePauseReason(preset, note) };
    run(
      () => pauseOrderingAction(pauseRequest(preset, note, mode, untilDate || undefined)),
      (result) => {
        if (!("status" in result)) return;
        const outcome = pauseOutcome(result, chosen);
        setMessage(outcome.message);
        if (outcome.close) {
          setChoosing(false);
          setNote("");
        }
      },
    );
  }

  function askToResume() {
    setMessage(null);
    resumeShownAt.current = Date.now();
    setResumeArmed(false);
    setConfirmingResume(true);
  }

  useEffect(() => {
    if (!confirmingResume) return;
    const timer = setTimeout(() => setResumeArmed(true), CONFIRM_ARM_MS);
    return () => clearTimeout(timer);
  }, [confirmingResume, armEpoch]);

  function resume() {
    if (!(status.state === "paused")) return;
    if (!confirmArmed(resumeShownAt.current, Date.now())) return;
    const shownPausedAt = status.pausedAt.toISOString();
    run(async () => {
      const result = await resumeOrderingAction({ shownPausedAt });
      if (!result.ok) {
        // The screen now shows a different pause than the one it asked to lift: arm the confirm afresh, so a tap
        // that was meant for the old one cannot lift the new one.
        resumeShownAt.current = Date.now();
        setResumeArmed(false);
        setArmEpoch((n) => n + 1);
      }
      if (!result.ok && result.code === "PAUSE_CHANGED") return { ...result, error: `${result.error} The pause now in force is shown above.` };
      return result;
    }, () => setConfirmingResume(false));
  }

  const stillDue = preview?.ordersStillDue ?? status.ordersStillDue;
  const restart = restartLine(mode, preview);

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
            <dd>{status.dayOff ? `Closed all day today${status.dayOff.note ? ` (${status.dayOff.note})` : ""}.` : "Outside opening hours."}</dd>
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
        <dt className="text-muted-foreground">Orders not finished</dt>
        <dd>{stillDue}</dd>
      </dl>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-md border-l-2 px-4 py-3 text-sm ${message.tone === "error" ? "border-loss bg-loss-soft/60" : "border-gain bg-gain-soft/60"}`}>
          {message.text}
        </p>
      )}

      {paused ? (
        confirmingResume ? (
          <div className="mt-4 grid gap-3 rounded-lg border border-border bg-panel p-4" role="group" aria-label="Confirm switching orders back on">
            <p className="text-sm font-semibold">Open the shop for online orders?</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmingResume(false)} disabled={pending} className={secondary}>
                Cancel
              </button>
              <button type="button" onClick={resume} disabled={pending || !resumeArmed} className={primary}>
                {pending ? "Switching on…" : "Open for orders"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <button type="button" onClick={askToResume} disabled={pending} className={primary}>
              Switch orders back on…
            </button>
          </div>
        )
      ) : !choosing ? (
        <div className="mt-4">
          <button type="button" onClick={openChooser} className={secondary}>
            Switch online orders off…
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 rounded-lg border border-border bg-panel p-4">
          <fieldset className="grid gap-2">
            <legend className="text-[13px] font-semibold">For how long?</legend>
            {PAUSE_MODE_OPTIONS.map(({ mode: value }) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm">
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="size-5 shrink-0" />
                <span>{PAUSE_MODE_LABELS[value]}{value === "UNTIL_NEXT_OPENING" ? " (default)" : ""}</span>
              </label>
            ))}
            {mode === "UNTIL_DATE" && (
              <div className="grid gap-1.5">
                <label htmlFor="close-shop-until" className="text-[13px] font-semibold">Orders restart on</label>
                <input
                  id="close-shop-until"
                  type="date"
                  value={untilDate}
                  min={untilDateBounds(new Date()).min}
                  max={untilDateBounds(new Date()).max}
                  onChange={(event) => chooseUntilDate(event.target.value)}
                  className="h-11 w-full rounded-md border border-border bg-panel px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
                />
              </div>
            )}
          </fieldset>

          <div className="grid gap-1.5">
            <label htmlFor="close-shop-note" className="text-[13px] font-semibold">
              Note <span className="font-normal text-muted-foreground">(optional, staff only — add before you tap a reason)</span>
            </label>
            <input
              id="close-shop-note"
              name="note"
              type="text"
              maxLength={PAUSE_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Fryer 2 is down"
              className="h-11 w-full rounded-md border border-border bg-panel px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
          </div>

          <div className="grid gap-1 text-sm" role="note">
            <p className="font-semibold">{restart ?? (pending ? "Checking opening hours…" : "Couldn't check the opening hours. You can still close: choose a reason below.")}</p>
            {stillDueLine(stillDue) && <p className="text-muted-foreground">{stillDueLine(stillDue)}</p>}
          </div>

          <div className="grid gap-2" role="group" aria-labelledby="close-shop-why">
            <span id="close-shop-why" className="text-[13px] font-semibold">Why? Tap one to switch orders off</span>
            <div className="grid grid-cols-2 gap-2">
              {PAUSE_REASON_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => confirmPause(preset)}
                  disabled={pending || (mode === "UNTIL_DATE" && !untilDate)}
                  className="inline-flex min-h-12 items-center justify-center rounded-md border border-loss bg-loss-soft/60 px-3 text-sm font-semibold transition-colors duration-[120ms] hover:bg-loss-soft disabled:opacity-60"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { setChoosing(false); setMessage(null); }} disabled={pending} className={secondary}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

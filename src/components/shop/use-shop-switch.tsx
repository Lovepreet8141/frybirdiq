"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ReloadAppButton } from "@/components/reload-app-button";
import { useOnline } from "@/components/pos/use-online";
import { PAUSE_MODES, pauseConfirmLines, pauseResultView, shopSwitchView } from "@/components/pos/shop-switch-view";
import { cn } from "@/lib/utils";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import type { PauseMode } from "@/lib/orders/opening-hours";
import { PAUSE_NOTE_MAX, PAUSE_REASON_PRESETS, type PauseReasonPreset, noteProblem, pauseRequest } from "@/lib/orders/pause-reasons";
import { CONFIRM_ARM_MS, confirmArmed, statusSignature } from "@/lib/orders/shop-pill";
import { pauseOrderingAction, previewPauseAction, readOrderingStatusAction, resumeOrderingAction } from "@/lib/orders/shop-status-actions";
import type { PausePreview, StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { publishShopStatus, subscribeShopStatus } from "./status-bus";

/** How often an idle screen re-reads the switch: another till or Admin may have moved it, or a timed pause ended. */
const STATUS_POLL_MS = 60_000;

type DialogKind = "pause" | "resume" | null;

/**
 * The Close Shop switch's state and its two dialogs, shared by the POS header
 * switch and the top-bar status pill (owner card, Release 3): ONE server action
 * pair, ONE dialog, ONE state. Nothing is optimistic (RELIABILITY RULE 1):
 * what is shown is the page's read, then whatever each action returned, then a
 * poll of the same read. If a pause did not take, the status the server hands
 * back says so, and so does the screen.
 *
 * Switching OFF: pick how long (the owner's default first), then TAP A REASON:
 * that tap closes the shop. Switching ON: a second, deliberate step (the
 * dialog), and its confirm button is inert for a moment so a double-tap can
 * never lift a pause.
 */
export function useShopSwitch({
  initialStatus,
  renderedAt,
  canSwitch,
}: {
  initialStatus: StaffOrderingStatus;
  /** The server's clock at render, so the first client render words times exactly as the server did. */
  renderedAt: string;
  canSwitch: boolean;
}) {
  const online = useOnline();
  const [status, setStatusState] = useState(initialStatus);
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [mode, setMode] = useState<PauseMode>("UNTIL_NEXT_OPENING");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<PausePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when a Pause changed nothing: the pause in force is at least as strict. Shown in the dialog, which stays open. */
  const [notApplied, setNotApplied] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [resumeArmed, setResumeArmed] = useState(false);
  const resumeShownAt = useRef<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const view = shopSwitchView(status, now);

  /** The one way state changes from a server answer: adopt it here and tell the other controls on this screen. */
  const adopt = useCallback((next: StaffOrderingStatus) => {
    setStatusState(next);
    setNow(new Date());
    publishShopStatus(next);
  }, []);

  // A fresh server render (Admin's panel switched it, a route change) hands new props: follow them.
  const signature = statusSignature(initialStatus);
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setStatusState(initialStatus);
    setNow(new Date(renderedAt));
  }, [signature, initialStatus, renderedAt]);

  // What the other control on this screen just learned from the server.
  useEffect(
    () =>
      subscribeShopStatus((next) => {
        setStatusState(next);
        setNow(new Date());
      }),
    [],
  );

  /* ---------------------------------------------------------------- polling */

  const refresh = useCallback(async () => {
    const result = await recoverFromStaleDeployment(() => readOrderingStatusAction());
    if (result.ok && "status" in result) adopt(result.status);
  }, [adopt]);

  useEffect(() => {
    if (!online || dialog !== null) return;
    const timer = setInterval(() => void refresh(), STATUS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [online, dialog, refresh]);

  // Tell the person when the state changed under them (another till, Admin, a timed pause ending).
  const lastState = useRef(status.state);
  useEffect(() => {
    if (lastState.current === status.state) return;
    lastState.current = status.state;
    setAnnouncement(
      status.state === "paused" ? "Online orders are now closed." : status.state === "closedByHours" ? "The shop is now closed by opening hours." : "Online orders are open.",
    );
  }, [status.state]);

  /* ----------------------------------------------------------------- actions */

  function openPause() {
    setError(null);
    setNotApplied(null);
    setNote("");
    setMode("UNTIL_NEXT_OPENING");
    setPreview(null);
    setDialog("pause");
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => previewPauseAction());
      if (result.ok && "preview" in result) setPreview(result.preview);
      else setError(result.error ?? "Couldn't check the opening hours. Try again.");
    });
  }

  /** The second tap: choosing a reason closes the shop. The note is optional. */
  function confirmPause(preset: PauseReasonPreset) {
    const problem = noteProblem(note);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setNotApplied(null);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => pauseOrderingAction(pauseRequest(preset, note, mode)));
      if (!result.ok) {
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      if (!("status" in result)) return;
      adopt(result.status);
      // The server's read decides, never this tap: if the pause did not take,
      // or a pause at least as strict was already in force, say so and keep the
      // dialog open — closing it would read as "done".
      const outcome = pauseResultView(result);
      if (outcome.kind === "not-taken") setError(outcome.message);
      else if (outcome.kind === "not-applied") setNotApplied(outcome.message);
      else {
        setDialog(null);
        setAnnouncement("Online orders are now closed.");
      }
    });
  }

  function openResume() {
    setError(null);
    setResumeArmed(false);
    resumeShownAt.current = Date.now();
    setDialog("resume");
  }

  useEffect(() => {
    if (dialog !== "resume") return;
    const timer = setTimeout(() => setResumeArmed(true), CONFIRM_ARM_MS);
    return () => clearTimeout(timer);
  }, [dialog]);

  function confirmResume() {
    if (status.state !== "paused") return;
    // A double-tap on the control that opened this must never lift the pause.
    if (!confirmArmed(resumeShownAt.current, Date.now())) return;
    const shownPausedAt = status.pausedAt.toISOString();
    setError(null);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => resumeOrderingAction({ shownPausedAt }));
      if ("status" in result) adopt(result.status);
      if (!result.ok) {
        // PAUSE_CHANGED: someone set a different pause since this screen loaded.
        // The dialog stays open on the pause that is actually in force.
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      setDialog(null);
      setAnnouncement("Online orders are open again.");
    });
  }

  const canPress = canSwitch && online && !isPending;

  const dialogs = (
    <>
      {/* ------------------------------------------------ switch OFF: pause */}
      <Dialog open={dialog === "pause"} onOpenChange={(next) => !isPending && setDialog(next ? "pause" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close the shop for online orders</DialogTitle>
            <DialogDescription>Customers won&apos;t be able to order online, now or for later, until the shop opens again.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span id="shop-switch-mode" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                How long
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-labelledby="shop-switch-mode">
                {PAUSE_MODES.map((option) => {
                  const isActive = mode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setMode(option.mode)}
                      disabled={isPending}
                      className={cn(
                        "flex min-h-[56px] touch-manipulation select-none items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors duration-[var(--duration-micro)]",
                        isActive
                          ? "border-inverse bg-inverse text-inverse-foreground"
                          : "border-border bg-panel text-foreground hover:border-border-strong active:bg-surface-muted",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span id="shop-switch-why" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Why? Tap one to close the shop
              </span>
              <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="shop-switch-why">
                {PAUSE_REASON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => confirmPause(preset)}
                    disabled={isPending || !online || notApplied !== null}
                    className="flex min-h-[56px] touch-manipulation select-none items-center justify-center rounded-lg border border-destructive/50 bg-destructive/10 px-3 text-sm font-semibold text-foreground transition-colors duration-[var(--duration-micro)] hover:border-destructive active:bg-destructive/20 disabled:opacity-60"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Note <span className="font-normal text-muted-foreground">(optional, staff only — add before you tap a reason)</span>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={PAUSE_NOTE_MAX}
                rows={1}
                placeholder="Fryer 2 is down…"
                disabled={isPending}
                className="min-h-[48px] font-normal"
              />
            </label>

            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm" aria-live="polite">
              {preview ? (
                pauseConfirmLines(mode, preview).map((line) => <p key={line}>{line}</p>)
              ) : (
                <p className="text-muted-foreground">{error ? "Couldn't load this." : "Checking the opening hours…"}</p>
              )}
            </div>

            {error && (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
                {error}
                {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
              </div>
            )}
            {notApplied && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-foreground">
                {notApplied}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            {notApplied ? (
              <Button type="button" className="min-h-[56px]" onClick={() => setDialog(null)}>
                OK
              </Button>
            ) : (
              <Button type="button" variant="outline" className="min-h-[56px]" onClick={() => setDialog(null)} disabled={isPending}>
                {isPending ? "Closing…" : "Cancel"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------- switch ON: resume */}
      <Dialog open={dialog === "resume"} onOpenChange={(next) => !isPending && setDialog(next ? "resume" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open the shop for online orders?</DialogTitle>
            <DialogDescription>{view.open ? "The shop is already open for orders." : view.detail}</DialogDescription>
          </DialogHeader>
          {view.reason && <p className="text-sm text-muted-foreground">Reason: {view.reason}</p>}
          {error && (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
              {error}
              {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-[56px]" onClick={() => setDialog(null)} disabled={isPending}>
              {view.open ? "Close" : "Keep it closed"}
            </Button>
            {!view.open && (
              <Button type="button" className="min-h-[56px]" onClick={confirmResume} disabled={isPending || !online || !resumeArmed}>
                {isPending ? "Opening…" : "Open for orders"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );

  return { status, now, view, online, isPending, canPress, canSwitch, announcement, dialogOpen: dialog !== null, openPause, openResume, dialogs };
}

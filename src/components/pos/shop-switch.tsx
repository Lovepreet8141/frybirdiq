"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { businessDate } from "@/lib/dates";
import type { PauseMode } from "@/lib/orders/opening-hours";
import {
  pauseOrderingAction,
  previewPauseAction,
  readOrderingStatusAction,
  resumeOrderingAction,
} from "@/lib/orders/shop-status-actions";
import type { PausePreview, StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { useOnline } from "./use-online";
import { PAUSE_MODES, morningPrompt, morningPromptKey, pauseConfirmLines, pauseNotAppliedLine, reasonProblem, shopSwitchView } from "./shop-switch-view";

/** How often an idle POS re-reads the switch: another till or Admin may have moved it, or a timed pause ended. */
const STATUS_POLL_MS = 60_000;

/** The morning prompt is not one of these: it opens by itself, from `morningOpen`. */
type DialogKind = "pause" | "resume" | null;

/**
 * The Close Shop switch on the POS header (ops-1 S4a, owner requirement 1).
 *
 * One switch — "Shop is OPEN for orders" / "Shop is CLOSED for orders" — and,
 * while closed, a strip under the tabs that always says who closed it, when,
 * and when it reopens.
 *
 * Every state shown comes from the server's read (RELIABILITY RULE 1): the
 * page's `getOrderingStatusForStaff`, then whatever each action returns, then
 * a poll of the same read. Nothing is optimistic. If a pause did not take, the
 * status the server hands back says OPEN, and so does this screen, at once —
 * which is what makes it safe for a missing value to read as "not paused".
 *
 * Switching OFF asks how long (the owner's two choices, "until we next open"
 * first), requires a reason, and shows before confirming what confirming
 * would do — "Orders restart today at 11:30 AM" and how many orders are still
 * due — on the server's clock at the moment the dialog opens. Switching ON
 * names the pause being lifted, so a stale screen cannot lift a newer one.
 */
export function ShopSwitch({
  orgId,
  initialStatus,
  renderedAt,
  canSwitch,
}: {
  orgId: string;
  initialStatus: StaffOrderingStatus;
  /** The server's clock at render, so the first client render words times exactly as the server did. */
  renderedAt: string;
  /** orders.update. The action checks again on every call; this only decides whether to offer the control. */
  canSwitch: boolean;
}) {
  const online = useOnline();
  const [status, setStatus] = useState(initialStatus);
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [mode, setMode] = useState<PauseMode>("UNTIL_NEXT_OPENING");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PausePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when a Pause changed nothing: the pause in force is at least as strict. Shown in the dialog, which stays open. */
  const [notApplied, setNotApplied] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, startTransition] = useTransition();

  const view = shopSwitchView(status, now);

  /* ---------------------------------------------------------------- polling */

  const refresh = useCallback(async () => {
    const result = await recoverFromStaleDeployment(() => readOrderingStatusAction());
    if (result.ok && "status" in result) {
      setStatus(result.status);
      setNow(new Date());
    }
  }, []);

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

  /* ---------------------------------------------------------- morning prompt */

  const askedOn = useStoredDay(morningPromptKey(orgId));
  const [morningDismissed, setMorningDismissed] = useState(false);
  const morningText = askedOn === UNKNOWN || morningDismissed ? null : morningPrompt(status, now, askedOn);
  const morningOpen = canSwitch && morningText !== null && dialog === null;

  function rememberAskedToday() {
    setMorningDismissed(true);
    try {
      window.localStorage.setItem(morningPromptKey(orgId), businessDate(now));
    } catch {
      // Storage unavailable (private window): the prompt may ask again on reload, which is harmless.
    }
  }

  /* ----------------------------------------------------------------- actions */

  function openPause() {
    setError(null);
    setNotApplied(null);
    setReason("");
    setMode("UNTIL_NEXT_OPENING");
    setPreview(null);
    setDialog("pause");
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => previewPauseAction());
      if (result.ok && "preview" in result) setPreview(result.preview);
      else setError(result.error ?? "Couldn't check the opening hours. Try again.");
    });
  }

  function confirmPause() {
    const problem = reasonProblem(reason);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => pauseOrderingAction({ reason, mode }));
      if (!result.ok) {
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      if (!("status" in result)) return;
      setStatus(result.status);
      setNow(new Date());
      // The server's read decides, never this click: if the pause did not take,
      // say so plainly rather than show a switch that isn't true.
      if (result.status.state !== "paused") {
        setError("That didn't take. The shop is still open for orders. Try again, and tell the owner if it keeps happening.");
        return;
      }
      if (!result.changed) {
        // A pause at least as strict was already in force, so this choice was
        // NOT applied. Say so on screen, with whose pause holds and until when,
        // and keep the dialog open — closing it would read as "done".
        setNotApplied(pauseNotAppliedLine(result.status));
        return;
      }
      setDialog(null);
      setAnnouncement("Online orders are now closed.");
    });
  }

  function openResume() {
    setError(null);
    setDialog("resume");
  }

  function confirmResume() {
    if (status.state !== "paused") return;
    const shownPausedAt = status.pausedAt.toISOString();
    setError(null);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => resumeOrderingAction({ shownPausedAt }));
      if ("status" in result) {
        setStatus(result.status);
        setNow(new Date());
      }
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

  function keepClosed() {
    rememberAskedToday();
  }

  function openFromMorning() {
    rememberAskedToday();
    openResume();
  }

  /* ------------------------------------------------------------------ render */

  const disabledReason = !online ? "You're offline. The switch can't be changed until connection returns." : null;
  const canPress = canSwitch && online && !isPending;

  return (
    <>
      <button
        type="button"
        onClick={view.open ? openPause : openResume}
        disabled={!canPress}
        aria-label={`${view.title}. ${view.detail}${canSwitch ? " Tap to change." : ""}`}
        className={cn(
          "ml-auto flex min-h-[56px] touch-manipulation select-none items-center gap-2 rounded-lg border px-3 text-left text-sm font-semibold transition-colors duration-[var(--duration-micro)]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
          view.open ? "border-border bg-panel text-foreground" : "border-destructive/40 bg-destructive/10 text-foreground",
          canPress ? "hover:border-border-strong active:bg-surface-muted" : "cursor-default",
        )}
      >
        <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", view.open ? "bg-success" : "bg-destructive")} />
        <span className="leading-tight">{view.title}</span>
      </button>

      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {/* While closed, the who/when/reopens strip spans the full width under the tabs. */}
      {!view.open && (
        <div role="status" className="order-last basis-full border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          <p className="font-semibold">{view.detail}</p>
          {view.reason && <p className="text-muted-foreground">Reason: {view.reason}</p>}
          {!canSwitch && <p className="text-muted-foreground">Ask a manager to open the shop for orders.</p>}
        </div>
      )}
      {disabledReason && canSwitch && (
        <p className="order-last basis-full px-3 py-1 text-xs text-muted-foreground">{disabledReason}</p>
      )}

      {/* ------------------------------------------------ switch OFF: pause */}
      <Dialog open={dialog === "pause"} onOpenChange={(next) => !isPending && setDialog(next ? "pause" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close the shop for online orders?</DialogTitle>
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

            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Why
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={200}
                rows={2}
                placeholder="Power cut, fryer down…"
                disabled={isPending}
                aria-invalid={error !== null && reasonProblem(reason) !== null}
                className="min-h-[56px] font-normal"
              />
              <span className="text-xs font-normal text-muted-foreground">Staff only. Customers never see this.</span>
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
              <>
                <Button type="button" variant="outline" className="min-h-[56px]" onClick={() => setDialog(null)} disabled={isPending}>
                  Keep it open
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-[56px]"
                  onClick={confirmPause}
                  disabled={isPending || !online || preview === null}
                >
                  {isPending && preview ? "Closing…" : "Close for orders"}
                </Button>
              </>
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
              <Button type="button" className="min-h-[56px]" onClick={confirmResume} disabled={isPending || !online}>
                {isPending ? "Opening…" : "Open for orders"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------ first screen of the day: carried over */}
      <Dialog open={morningOpen} onOpenChange={(next) => !next && keepClosed()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The shop is still closed for online orders</DialogTitle>
            <DialogDescription>{morningText}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-[56px]" onClick={keepClosed}>
              Keep it closed
            </Button>
            <Button type="button" className="min-h-[56px]" onClick={openFromMorning} disabled={!online}>
              Open for orders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ storage */

const UNKNOWN = "__unknown__";

/**
 * The business day stored under `key`, or null — read with
 * useSyncExternalStore so the server render (which cannot see storage) and
 * the first client render agree, and the prompt appears only once the browser
 * has actually looked. Storage can throw in a private window; that reads as
 * "never asked", which at worst asks again.
 */
function useStoredDay(key: string): string | null {
  return useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => UNKNOWN,
  );
}

function subscribeStorage(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

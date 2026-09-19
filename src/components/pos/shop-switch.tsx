"use client";

import { useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useShopSwitch } from "@/components/shop/use-shop-switch";
import { businessDate } from "@/lib/dates";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { morningPrompt, morningPromptKey } from "./shop-switch-view";

/**
 * The Close Shop switch on the POS header (ops-1 S4a, owner requirement 1). The state, the actions and the two
 * dialogs live in `useShopSwitch`, shared with the top-bar status pill; this file keeps the header button, the
 * who/when strip and the morning prompt.
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
  const shop = useShopSwitch({ initialStatus, renderedAt, canSwitch });
  const { status, now, view, online, canPress, announcement, openPause, openResume } = shop;

  /* ---------------------------------------------------------- morning prompt */

  const askedOn = useStoredDay(morningPromptKey(orgId));
  const [morningDismissed, setMorningDismissed] = useState(false);
  const morningText = askedOn === UNKNOWN || morningDismissed ? null : morningPrompt(status, now, askedOn);
  const morningOpen = canSwitch && morningText !== null && !shop.dialogOpen;

  function rememberAskedToday() {
    setMorningDismissed(true);
    try {
      window.localStorage.setItem(morningPromptKey(orgId), businessDate(now));
    } catch {
      // Storage unavailable (private window): the prompt may ask again on reload, which is harmless.
    }
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

      {shop.dialogs}

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

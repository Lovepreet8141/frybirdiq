"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlarmClock, Loader2 } from "lucide-react";
import { ReloadAppButton } from "@/components/reload-app-button";
import { OfflineState } from "@/components/states";
import { useOnline } from "@/components/pos/use-online";
import { useChime } from "@/components/staff/use-chime";
import { useOrderEvents } from "@/lib/realtime/client";
import { pollKitchenBoard } from "@/lib/kitchen/board-action";
import { advanceOrderAction } from "@/lib/auth/staff-actions";
import { STALE_DEPLOYMENT_MESSAGE, isStaleDeploymentError } from "@/lib/errors/stale-deployment";
import { type KitchenStatus, type KitchenTicket, nextKitchenStatus, prepHealth, waitingMinutes } from "@/lib/kitchen/tickets";
import { cn } from "@/lib/utils";

/** Fallback only: the order_events channel moves tickets the moment they change (roadmap 2.2); this catches a dropped socket. */
const POLL_MS = 60_000;
/** How often the "waiting" minutes re-render between polls. */
const CLOCK_MS = 30_000;

const COLUMNS: readonly { status: KitchenStatus; label: string }[] = [
  { status: "ACCEPTED", label: "New" },
  { status: "PREPARING", label: "Cooking" },
  { status: "READY", label: "Ready" },
];

function fulfilmentLabel(ticket: KitchenTicket): string {
  if (ticket.fulfilment === "DINE_IN") return ticket.tableName ?? "Dine-in";
  if (ticket.fulfilment === "DELIVERY") return "Delivery";
  return "Collection";
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

/**
 * The kitchen display. Three columns, oldest ticket at the top of each,
 * one big button per ticket. Nothing here decides a transition — the button
 * asks `advanceOrderAction` for the one move `nextKitchenStatus` names, and
 * the server decides whether it is legal, exactly as the Orders screen does.
 *
 * No station, no routing, no priority score. The one judgement shown is
 * `prepHealth`: amber at 80% of the ticket's prep target, red at 100% or past
 * the promised time — a rule from configured data, not a model. A ticket with
 * no target configured stays neutral. Nothing animates: a screen a cook glances at
 * two hundred times a shift must never be mid-transition.
 */
export function KdsBoard({ initial, canUpdate, orgId }: { initial: readonly KitchenTicket[]; canUpdate: boolean; orgId: string }) {
  const [tickets, setTickets] = useState<readonly KitchenTicket[]>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [staleDeployment, setStaleDeployment] = useState(false);
  const online = useOnline();
  const tickRef = useRef<(() => Promise<void>) | null>(null);
  const { play } = useChime();
  /** Ticket ids already on the board, so only a genuinely new one sounds. Null until the first render has been seen. */
  const seenIds = useRef<Set<string> | null>(null);

  // A new order event anywhere in the organization re-reads the tickets at
  // once (roadmap 2.2, 2.4). The 60 s poll below is only for a dropped socket.
  useOrderEvents(orgId, () => void tickRef.current?.(), online);

  // Sound once per new ticket — one burst, not the counter's persistent
  // alarm: the cook is looking at this screen, the counter may not be.
  useEffect(() => {
    const ids = new Set(tickets.map((ticket) => ticket.id));
    if (seenIds.current === null) {
      seenIds.current = ids;
      return;
    }
    let fresh = false;
    for (const id of ids) if (!seenIds.current.has(id)) fresh = true;
    seenIds.current = ids;
    if (fresh) play();
  }, [tickets, play]);

  useEffect(() => {
    if (!online) return;
    let stopped = false;

    const tick = async () => {
      let result;
      try {
        result = await pollKitchenBoard();
      } catch (error) {
        if (!isStaleDeploymentError(error)) throw error;
        if (!stopped) setStaleDeployment(true);
        return;
      }
      if (stopped) return;
      setTickets(result.tickets);
      setNow(Date.now());
    };

    tickRef.current = tick;
    const poll = setInterval(() => void tick(), POLL_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(clockTimer);
    };
  }, [online]);

  const refresh = async () => {
    const result = await pollKitchenBoard();
    setTickets(result.tickets);
    setNow(Date.now());
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {staleDeployment && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {STALE_DEPLOYMENT_MESSAGE}
          <ReloadAppButton />
        </div>
      )}
      {!online && <OfflineState />}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const inColumn = tickets.filter((ticket) => ticket.status === column.status);
          return (
            <section key={column.status} aria-labelledby={`kds-${column.status}`} className="flex min-h-0 flex-col rounded-lg border border-border bg-surface">
              <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
                <h2 id={`kds-${column.status}`} className="font-heading text-lg font-bold">
                  {column.label}
                </h2>
                <span className="tabular text-sm font-semibold text-muted-foreground">{inColumn.length}</span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                {inColumn.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {column.status === "READY" ? "Nothing waiting to go out." : "Nothing here."}
                  </p>
                ) : (
                  inColumn.map((ticket) => <Ticket key={ticket.id} ticket={ticket} now={now} canUpdate={canUpdate} onChanged={refresh} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Ticket({ ticket, now, canUpdate, onChanged }: { ticket: KitchenTicket; now: number; canUpdate: boolean; onChanged: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const health = prepHealth(ticket, now);
  const late = health === "RED";
  const nearly = health === "AMBER";
  const minutes = waitingMinutes(ticket, now);
  const next = nextKitchenStatus(ticket.status);

  const advance = () => {
    if (!next) return;
    setError(null);
    startTransition(async () => {
      const result = await advanceOrderAction({ orderId: ticket.id, to: next.to });
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      await onChanged();
    });
  };

  return (
    <article
      aria-label={`Order ${ticket.orderNumber}`}
      className={cn("flex flex-col gap-3 rounded-xl border-2 bg-panel p-4", late ? "border-loss" : nearly ? "border-flag" : "border-border")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="tabular font-heading text-3xl font-black leading-none">#{ticket.orderNumber}</span>
          <span className="mt-1 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{fulfilmentLabel(ticket)}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          {/* Said in words and in colour, never colour alone. */}
          {late && (
            <span className="flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-destructive-foreground">
              <AlarmClock className="size-3.5" aria-hidden="true" />
              Late
            </span>
          )}
          {nearly && (
            <span className="flex items-center gap-1 rounded-full bg-flag-soft px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-flag">
              <AlarmClock className="size-3.5" aria-hidden="true" />
              Nearly late
            </span>
          )}
          <span className={cn("tabular text-2xl font-bold leading-none", late && "text-destructive", nearly && "text-flag")}>{minutes} min</span>
          {ticket.prepTargetMinutes !== null && <span className="tabular text-xs text-muted-foreground">target {ticket.prepTargetMinutes} min</span>}
          {ticket.promisedAt && <span className="tabular text-xs text-muted-foreground">by {clock(ticket.promisedAt)}</span>}
        </div>
      </div>

      <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
        {ticket.items.map((item, index) => (
          <li key={index} className="text-lg leading-snug">
            <span className="tabular font-bold">{item.quantity}×</span> <span className="font-semibold">{item.name}</span>
            {item.modifiers.length > 0 && <span className="block pl-7 text-base text-muted-foreground">{item.modifiers.join(", ")}</span>}
          </li>
        ))}
      </ul>

      {ticket.notes && <p className="rounded-md bg-warning/15 px-3 py-2 text-base font-semibold">{ticket.notes}</p>}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {next && canUpdate && (
        <button
          type="button"
          onClick={advance}
          disabled={pending}
          className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : next.label}
        </button>
      )}
      {!next && <p className="text-center text-sm font-semibold text-muted-foreground">Waiting for the counter to hand over</p>}
    </article>
  );
}

"use client";

import { useState, useTransition } from "react";
import { AlarmClock, Check, Loader2, Undo2 } from "lucide-react";
import { ReloadAppButton } from "@/components/reload-app-button";
import { EmptyState, ErrorState, OfflineState } from "@/components/states";
import { markOrderReadyAction, setLineDoneAction, setOrderPackedAction } from "@/lib/kitchen/stations-action";
import { type ExpoOrder, type LineStation, type PackState, STATION_LABEL, type StationLine, type StationOrder, expoView, packBoard, stationBoard } from "@/lib/kitchen/stations";
import { prepHealth, waitingMinutes } from "@/lib/kitchen/tickets";
import { cn } from "@/lib/utils";
import { useStationOrders } from "./use-station-orders";

function fulfilmentLabel(order: StationOrder): string {
  if (order.fulfilment === "DINE_IN") return order.tableName ?? "Dine-in";
  if (order.fulfilment === "DELIVERY") return "Delivery";
  return "Collection";
}

function Banners({ state }: { state: ReturnType<typeof useStationOrders> }) {
  return (
    <>
      {state.staleDeployment && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {state.staleMessage}
          <ReloadAppButton />
        </div>
      )}
      {!state.online && <OfflineState />}
      {state.error && state.online && (
        <ErrorState
          title="Could not refresh"
          detail={state.error}
          action={
            <button type="button" onClick={() => void state.refresh()} className="min-h-[44px] rounded-md border border-border bg-panel px-4 text-sm font-semibold">
              Try now
            </button>
          }
        />
      )}
    </>
  );
}

/** Same colour language as the main board: amber at 80% of the prep target, red at 100% or past the promise. Words as well as colour. */
function OrderHeader({ order, now }: { order: StationOrder; now: number }) {
  const health = prepHealth(order, now);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col">
        <span className="tabular font-heading text-3xl font-black leading-none">#{order.orderNumber}</span>
        <span className="mt-1 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{fulfilmentLabel(order)}</span>
      </div>
      <div className="flex flex-col items-end gap-1">
        {health === "RED" && (
          <span className="flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-destructive-foreground">
            <AlarmClock className="size-3.5" aria-hidden="true" />
            Late
          </span>
        )}
        {health === "AMBER" && (
          <span className="flex items-center gap-1 rounded-full bg-flag-soft px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-flag">
            <AlarmClock className="size-3.5" aria-hidden="true" />
            Nearly late
          </span>
        )}
        <span className={cn("tabular text-2xl font-bold leading-none", health === "RED" && "text-destructive", health === "AMBER" && "text-flag")}>{waitingMinutes(order, now)} min</span>
        {order.prepTargetMinutes !== null && <span className="tabular text-xs text-muted-foreground">target {order.prepTargetMinutes} min</span>}
      </div>
    </div>
  );
}

const cardBorder = (health: string) => (health === "RED" ? "border-loss" : health === "AMBER" ? "border-flag" : "border-border");

function LineRow({ line, canUpdate, onChanged, onError }: { line: StationLine; canUpdate: boolean; onChanged: () => Promise<void>; onError: (message: string | null) => void }) {
  const [pending, startTransition] = useTransition();
  const toggle = () => {
    onError(null);
    startTransition(async () => {
      const result = await setLineDoneAction({ orderItemId: line.id, done: !line.done, station: line.station });
      if (!result.ok) {
        onError(result.error ?? "That didn't work.");
        return;
      }
      await onChanged();
    });
  };
  return (
    <li className="flex items-start justify-between gap-3">
      <div className={cn("text-lg leading-snug", line.done && "text-muted-foreground line-through")}>
        <span className="tabular font-bold">{line.quantity}×</span> <span className="font-semibold">{line.name}</span>
        {line.modifiers.length > 0 && <span className="block pl-7 text-base text-muted-foreground">{line.modifiers.join(", ")}</span>}
      </div>
      {canUpdate && (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-label={line.done ? `Undo ${line.name}` : `Mark ${line.name} done`}
          className={cn("flex min-h-[56px] min-w-[96px] items-center justify-center gap-1.5 rounded-md px-4 text-base font-bold disabled:opacity-50", line.done ? "border border-border bg-panel" : "bg-primary text-primary-foreground")}
        >
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : line.done ? <><Undo2 className="size-4" aria-hidden="true" />Undo</> : <><Check className="size-5" aria-hidden="true" />Done</>}
        </button>
      )}
    </li>
  );
}

/** One station's screen: only its own lines, marked done one at a time. */
export function StationBoard({ station, initial, canUpdate, orgId }: { station: LineStation; initial: readonly StationOrder[]; canUpdate: boolean; orgId: string }) {
  const state = useStationOrders(initial, orgId);
  const [lineError, setLineError] = useState<string | null>(null);
  const board = stationBoard(state.orders, station);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Banners state={state} />
      {lineError && (
        <p role="alert" className="text-sm text-destructive">
          {lineError}
        </p>
      )}
      <h1 className="font-heading text-xl font-bold">
        {STATION_LABEL[station]} <span className="tabular text-base font-semibold text-muted-foreground">{board.length}</span>
      </h1>
      {board.length === 0 ? (
        <EmptyState title={`Nothing for ${STATION_LABEL[station]} right now`} detail="New orders appear here as soon as they are accepted." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {board.map((order) => (
            <article key={order.id} aria-label={`Order ${order.orderNumber}`} className={cn("flex flex-col gap-3 rounded-xl border-2 bg-panel p-4", cardBorder(prepHealth(order, state.now)))}>
              <OrderHeader order={order} now={state.now} />
              <ul className="flex flex-col gap-3 border-t border-border pt-3">
                {order.lines.map((line) => (
                  <LineRow key={`${line.id}-${line.station}`} line={line} canUpdate={canUpdate} onChanged={state.refresh} onError={setLineError} />
                ))}
              </ul>
              {order.notes && <p className="rounded-md bg-warning/15 px-3 py-2 text-base font-semibold">{order.notes}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const PACK_TEXT: Record<PackState, string> = { WAITING: "Pack: waiting", READY_TO_PACK: "Pack: ready to pack", PACKED: "Pack: packed" };

function PackChip({ state }: { state: PackState }) {
  const packed = state === "PACKED";
  return (
    <li className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold", packed ? "border-gain/40 bg-gain-soft text-gain" : state === "READY_TO_PACK" ? "border-flag/40 bg-flag-soft text-flag" : "border-border")}>
      {packed && <Check className="size-3.5" aria-hidden="true" />}
      {PACK_TEXT[state]}
    </li>
  );
}

function ExpoCard({ order, now, canUpdate, onChanged }: { order: ExpoOrder; now: number; canUpdate: boolean; onChanged: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const bump = () => {
    setError(null);
    startTransition(async () => {
      const result = await markOrderReadyAction({ orderId: order.id });
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      await onChanged();
    });
  };

  return (
    <article aria-label={`Order ${order.orderNumber}`} className={cn("flex flex-col gap-3 rounded-xl border-2 bg-panel p-4", cardBorder(prepHealth(order, now)))}>
      <OrderHeader order={order} now={now} />
      <ul className="flex flex-wrap gap-2 border-t border-border pt-3" aria-label="Station progress">
        {order.stations.map((progress) => {
          const complete = progress.done === progress.total;
          return (
            <li key={progress.station} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold", complete ? "border-gain/40 bg-gain-soft text-gain" : "border-border")}>
              {complete && <Check className="size-3.5" aria-hidden="true" />}
              {STATION_LABEL[progress.station]}
              <span className="tabular">
                {progress.done}/{progress.total}
              </span>
              <span className="sr-only">{complete ? "done" : "in progress"}</span>
            </li>
          );
        })}
        {order.pack !== null && <PackChip state={order.pack} />}
      </ul>

      {order.notes && <p className="rounded-md bg-warning/15 px-3 py-2 text-base font-semibold">{order.notes}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {canUpdate ? (
        <button
          type="button"
          onClick={bump}
          disabled={pending || !order.readyToBump}
          className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : order.readyToBump ? "Mark ready" : order.pack === "READY_TO_PACK" ? "Waiting for pack" : "Waiting for stations"}
        </button>
      ) : (
        <p className="text-center text-sm font-semibold text-muted-foreground">{order.readyToBump ? "Every station is done" : order.pack === "READY_TO_PACK" ? "Waiting for pack" : "Waiting for stations"}</p>
      )}
    </article>
  );
}

/** EXPO: every live order with each station's progress; the one place an order is marked READY, and only once every line is done. */
export function ExpoBoard({ initial, canUpdate, orgId }: { initial: readonly StationOrder[]; canUpdate: boolean; orgId: string }) {
  const state = useStationOrders(initial, orgId);
  const board = expoView(state.orders);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Banners state={state} />
      <h1 className="font-heading text-xl font-bold">
        Expo <span className="tabular text-base font-semibold text-muted-foreground">{board.length}</span>
      </h1>
      {board.length === 0 ? (
        <EmptyState title="No orders in the kitchen" detail="Accepted orders appear here with each station's progress." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {board.map((order) => (
            <ExpoCard key={order.id} order={order} now={state.now} canUpdate={canUpdate} onChanged={state.refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function PackCard({ order, now, canUpdate, onChanged }: { order: StationOrder; now: number; canUpdate: boolean; onChanged: () => Promise<void> }) {
  const toPack = order.lines.filter((line) => line.station === "PACK");
  const rest = order.lines.filter((line) => line.station !== "PACK");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pack = () => {
    setError(null);
    startTransition(async () => {
      const result = await setOrderPackedAction({ orderId: order.id, packed: true });
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      await onChanged();
    });
  };
  return (
    <article aria-label={`Order ${order.orderNumber}`} className={cn("flex flex-col gap-3 rounded-xl border-2 bg-panel p-4", cardBorder(prepHealth(order, now)))}>
      <OrderHeader order={order} now={now} />
      <ul className="flex flex-col gap-1.5 border-t border-border pt-3" aria-label="Lines to pack">
        {toPack.length === 0 && <li className="text-sm text-muted-foreground">No sauces or dips on this order. Check the bag against the lines below.</li>}
        {toPack.map((line) => (
          <li key={`${line.id}-${line.station}`} className="text-lg leading-snug">
            <span className="tabular font-bold">{line.quantity}×</span> <span className="font-semibold">{line.name}</span>
            {line.modifiers.length > 0 && <span className="block pl-7 text-base text-muted-foreground">{line.modifiers.join(", ")}</span>}
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground" aria-label="Already made">
          {rest.map((line) => (
            <li key={`${line.id}-${line.station}`}>
              <span className="tabular font-semibold">{line.quantity}×</span> {line.name}
            </li>
          ))}
        </ul>
      )}
      {order.notes && <p className="rounded-md bg-warning/15 px-3 py-2 text-base font-semibold">{order.notes}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {canUpdate && (
        <button type="button" onClick={pack} disabled={pending} className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-50">
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : "Packed"}
        </button>
      )}
    </article>
  );
}

/** PACK: takeaway and delivery orders whose every other task is done and that are not yet packed. Lists the sauce and dip lines to pack; "Packed" completes them and the order step. Dine-in never appears. */
export function PackBoard({ initial, canUpdate, orgId }: { initial: readonly StationOrder[]; canUpdate: boolean; orgId: string }) {
  const state = useStationOrders(initial, orgId);
  const board = packBoard(state.orders);
  return (
    <div className="flex flex-col gap-3 p-3">
      <Banners state={state} />
      <h1 className="font-heading text-xl font-bold">
        {STATION_LABEL.PACK} <span className="tabular text-base font-semibold text-muted-foreground">{board.length}</span>
      </h1>
      {board.length === 0 ? (
        <EmptyState title="Nothing to pack right now" detail="Takeaway and delivery orders appear here once every station has finished its lines." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {board.map((order) => (
            <PackCard key={order.id} order={order} now={state.now} canUpdate={canUpdate} onChanged={state.refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

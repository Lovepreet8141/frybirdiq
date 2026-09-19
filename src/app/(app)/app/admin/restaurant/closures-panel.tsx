"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type ClosuresFormState, addClosedDateAction, removeClosedDateAction, saveWeeklyClosedDaysAction } from "@/lib/settings/closures-actions";
import type { PreOrderRow } from "@/lib/settings/closures-copy";

/**
 * Days the shop is closed all day (ops-3): the weekly day off, and planned
 * closed dates with a public note. Owner-only, and both actions re-check
 * `settings.manage` on the server. Nothing here cancels an order: a pre-order
 * booked for a closed day is listed, and stays until the owner decides.
 */

const inputClass = "h-11 w-full rounded-md border border-border bg-panel px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";
const button = "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-sm font-semibold transition-colors disabled:opacity-60";

/** Monday first, as the week is read here; the value is the calendar weekday (0 = Sunday). */
const WEEK = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
] as const;

export interface ClosedDateItem {
  readonly id: string;
  /** "Tue 23 Sep – Fri 26 Sep" */
  readonly label: string;
  readonly note: string | null;
  /** True while it is happening today. */
  readonly current: boolean;
}

function Submit({ label, pendingLabel, className }: { label: string; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: ClosuresFormState }) {
  if (state.status === "error") {
    return (
      <p role="alert" className="border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
        {state.message}
      </p>
    );
  }
  if (state.status === "success") {
    return (
      <p role="status" className="border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-sm">
        {state.message}
      </p>
    );
  }
  return null;
}

export function PreOrderList({ rows }: { rows: readonly PreOrderRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-loss bg-loss-soft/40 p-3 text-sm" data-testid="closed-day-preorders">
      <p className="font-semibold">
        {rows.length} {rows.length === 1 ? "pre-order is" : "pre-orders are"} booked for a closed day. Nothing has been cancelled or refused.
      </p>
      <ul className="mt-2 grid gap-1">
        {rows.map((row) => (
          <li key={row.orderId} className="flex flex-wrap items-baseline gap-x-3">
            <Link href={`/app/orders/${row.orderId}`} className="font-semibold underline underline-offset-2">
              #{row.orderNumber}
            </Link>
            <span>{row.customerName ?? "No name"}</span>
            <span className="text-muted-foreground">{row.when}</span>
            <span className="text-muted-foreground">{row.status.replaceAll("_", " ").toLowerCase()}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground">Call each customer to move or cancel it, or make it if you are opening after all.</p>
    </div>
  );
}

export function ClosuresPanel({
  weeklyClosedDays,
  closedDates,
  preOrders,
}: {
  readonly weeklyClosedDays: readonly number[];
  readonly closedDates: readonly ClosedDateItem[];
  /** Every pre-order booked for a closed day right now, so they stay visible after this page is reloaded. */
  readonly preOrders: readonly PreOrderRow[];
}) {
  const [weeklyState, weeklyAction] = useActionState<ClosuresFormState, FormData>(saveWeeklyClosedDaysAction, { status: "idle" });
  const [addState, addAction] = useActionState<ClosuresFormState, FormData>(addClosedDateAction, { status: "idle" });
  const [removeState, removeAction] = useActionState<ClosuresFormState, FormData>(removeClosedDateAction, { status: "idle" });

  return (
    <section aria-labelledby="closures-heading" className="flex flex-col gap-5 rounded-lg border border-border p-4 sm:p-5">
      <div>
        <h2 id="closures-heading" className="text-lg font-bold leading-tight">
          Days closed
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          On a closed day the website says so, online orders are refused, and nobody can book a time on it. Orders already booked are never cancelled for you.
        </p>
      </div>

      <PreOrderList rows={preOrders} />

      <form action={weeklyAction} className="grid gap-3">
        <fieldset className="grid gap-2">
          <legend className="text-[13px] font-semibold">Closed all day, every week</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WEEK.map((day) => (
              <label key={day.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm">
                <input type="checkbox" name="closedDay" value={day.value} defaultChecked={weeklyClosedDays.includes(day.value)} className="size-5 shrink-0" />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Feedback state={weeklyState} />
        {weeklyState.status === "success" && <PreOrderList rows={weeklyState.preOrders} />}
        <div className="flex justify-end">
          <Submit label="Save weekly days off" pendingLabel="Saving…" className={`${button} bg-primary text-primary-foreground`} />
        </div>
      </form>

      <div className="grid gap-3 border-t border-border pt-4">
        <h3 className="text-[13px] font-semibold">Planned closed dates</h3>
        {closedDates.length === 0 ? (
          <p className="text-sm text-muted-foreground">None planned.</p>
        ) : (
          <ul className="grid gap-2">
            {closedDates.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{item.label}</span>
                  {item.current && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs">happening now</span>}
                  {item.note && <span className="block break-words text-muted-foreground">Website says: {item.note}</span>}
                </span>
                <form action={removeAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <Submit label="Remove" pendingLabel="Removing…" className={`${button} border border-border bg-panel hover:bg-surface`} />
                </form>
              </li>
            ))}
          </ul>
        )}
        <Feedback state={removeState} />

        <form action={addAction} className="grid gap-3 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="closed-start" className="text-[13px] font-semibold">
                First closed day
              </label>
              <input id="closed-start" name="startDate" type="date" required className={inputClass} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="closed-end" className="text-[13px] font-semibold">
                Last closed day <span className="font-normal text-muted-foreground">(blank = just that day)</span>
              </label>
              <input id="closed-end" name="endDate" type="date" className={inputClass} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="closed-note" className="text-[13px] font-semibold">
              Note for customers <span className="font-normal text-muted-foreground">(optional, shown on the website)</span>
            </label>
            <input id="closed-note" name="note" type="text" maxLength={120} placeholder="Closed for Diwali" className={inputClass} />
          </div>
          <Feedback state={addState} />
          {addState.status === "success" && <PreOrderList rows={addState.preOrders} />}
          <div className="flex justify-end">
            <Submit label="Add closed date" pendingLabel="Adding…" className={`${button} bg-primary text-primary-foreground`} />
          </div>
        </form>
      </div>
    </section>
  );
}

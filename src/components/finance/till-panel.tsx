"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { closeCashSessionAction, openCashSessionAction, recordCashHandoverAction, type CashFormState } from "@/lib/cash/actions";
import { varianceWords } from "@/lib/cash/session";
import { type Paise, formatINR, isNegative, isZero } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The till (roadmap 5.1-5.2) on Finance: open with a float, close with a count,
 * take a rider's door cash into it. Everyone with `finance.view` sees it;
 * the buttons appear only with `finance.manage`, and the server checks again.
 *
 * The count is BLIND: while the till is open the expected amount is not shown,
 * so the number typed is what was really in the drawer. It is shown, with the
 * difference in words, the moment the till is closed.
 */

const inputClass = "h-11 w-full rounded-md border border-border bg-panel px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20";
const button = "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-sm font-semibold transition-colors disabled:opacity-60";

export interface TillSessionRow {
  readonly id: string;
  readonly openedAt: string;
  readonly openedBy: string | null;
  readonly openingFloat: Paise;
  readonly cashPaymentCount: number;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly countedCash: Paise | null;
  readonly expectedCash: Paise | null;
  readonly variance: Paise | null;
  readonly note: string | null;
}

export interface RiderCashItem {
  readonly riderUserId: string;
  readonly riderName: string | null;
  readonly paymentCount: number;
  readonly amount: Paise;
  readonly since: string;
}

function Submit({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(button, "bg-inverse text-inverse-foreground hover:bg-inverse/85")}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: CashFormState }) {
  if (state.status === "idle") return null;
  const error = state.status === "error";
  return (
    <p role={error ? "alert" : "status"} className={cn("rounded-md border-l-2 px-4 py-3 text-sm", error ? "border-loss bg-loss-soft/60" : "border-gain bg-gain-soft/60")}>
      {state.message}
    </p>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export function TillPanel({ open, recent, riders, canManage }: { readonly open: TillSessionRow | null; readonly recent: readonly TillSessionRow[]; readonly riders: readonly RiderCashItem[]; readonly canManage: boolean }) {
  const [openState, openAction] = useActionState<CashFormState, FormData>(openCashSessionAction, { status: "idle" });
  const [closeState, closeAction] = useActionState<CashFormState, FormData>(closeCashSessionAction, { status: "idle" });
  const [handoverState, handoverAction] = useActionState<CashFormState, FormData>(recordCashHandoverAction, { status: "idle" });

  return (
    <section aria-labelledby="till-heading" className="flex flex-col gap-5 rounded-lg border border-border p-4 sm:p-5" data-till="">
      <div>
        <h2 id="till-heading" className="text-lg font-bold leading-tight">
          Till
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Open the till with its float, count it when you close. Every counter cash payment while it is open goes into it; a rider&apos;s door cash goes in when the rider hands it over.</p>
      </div>

      {open ? (
        <div className="grid gap-3 rounded-md border border-border p-3" data-till-open="">
          <p className="text-sm font-semibold">Till is open</p>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Opened</dt>
            <dd>
              {when(open.openedAt)} by {open.openedBy ?? "a staff member"}
            </dd>
            <dt className="text-muted-foreground">Float</dt>
            <dd>{formatINR(open.openingFloat)}</dd>
            <dt className="text-muted-foreground">Cash payments in it</dt>
            <dd>{open.cashPaymentCount}</dd>
          </dl>
          <p className="text-[13px] text-muted-foreground">What the till should hold is shown after you close it, so the count you type is what is really in the drawer.</p>
          {canManage && (
            <form action={closeAction} className="grid gap-3 border-t border-border pt-3">
              <input type="hidden" name="sessionId" value={open.id} />
              <div className="grid gap-1.5">
                <label htmlFor="till-counted" className="text-[13px] font-semibold">
                  Cash counted in the drawer (₹)
                </label>
                <input id="till-counted" name="countedCash" type="text" inputMode="decimal" required placeholder="e.g. 3450" className={inputClass} />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="till-close-note" className="text-[13px] font-semibold">
                  Note <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input id="till-close-note" name="note" type="text" maxLength={200} className={inputClass} />
              </div>
              <Feedback state={closeState} />
              <div className="flex justify-end">
                <Submit label="Close the till" pending="Closing…" />
              </div>
            </form>
          )}
        </div>
      ) : canManage ? (
        <form action={openAction} className="grid gap-3 rounded-md border border-border p-3">
          <p className="text-sm font-semibold">No till is open</p>
          <div className="grid gap-1.5">
            <label htmlFor="till-float" className="text-[13px] font-semibold">
              Float put in the drawer (₹)
            </label>
            <input id="till-float" name="openingFloat" type="text" inputMode="decimal" required placeholder="e.g. 2000" className={inputClass} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="till-open-note" className="text-[13px] font-semibold">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input id="till-open-note" name="note" type="text" maxLength={200} className={inputClass} />
          </div>
          <Feedback state={openState} />
          <div className="flex justify-end">
            <Submit label="Open the till" pending="Opening…" />
          </div>
        </form>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">No till is open. Opening and closing it needs the finance permission.</p>
      )}
      {!open && closeState.status !== "idle" && <Feedback state={closeState} />}

      <div className="grid gap-2" data-rider-cash="">
        <h3 className="text-[13px] font-semibold">Door cash riders are carrying</h3>
        {riders.length === 0 ? (
          <p className="text-sm text-muted-foreground">None. Every rider has handed over what they took at the door.</p>
        ) : (
          <ul className="grid gap-2">
            {riders.map((rider) => (
              <li key={rider.riderUserId} className="grid gap-2 rounded-md border border-border p-3 text-sm">
                <p>
                  <span className="font-semibold">{rider.riderName ?? "A rider"}</span> is carrying {formatINR(rider.amount)} from {rider.paymentCount} {rider.paymentCount === 1 ? "delivery" : "deliveries"}, since {when(rider.since)}.
                </p>
                {canManage && open ? (
                  <form action={handoverAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="riderUserId" value={rider.riderUserId} />
                    <div className="grid gap-1">
                      <label htmlFor={`handover-${rider.riderUserId}`} className="text-[13px] font-semibold">
                        Cash handed over (₹)
                      </label>
                      <input id={`handover-${rider.riderUserId}`} name="declaredCash" type="text" inputMode="decimal" required className={cn(inputClass, "w-40")} />
                    </div>
                    <Submit label="Receive it" pending="Saving…" />
                  </form>
                ) : (
                  <p className="text-[13px] text-muted-foreground">{canManage ? "Open the till to receive this cash." : "Receiving it needs the finance permission."}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <Feedback state={handoverState} />
      </div>

      <div className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Closed tills</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="grid gap-2">
            {recent.map((row) => (
              <li key={row.id} className="grid gap-0.5 rounded-md border border-border p-3 text-sm" data-till-closed="">
                <p className="font-semibold">
                  {row.closedAt ? when(row.closedAt) : ""} · closed by {row.closedBy ?? "a staff member"}
                </p>
                <p>
                  Counted {row.countedCash === null ? "—" : formatINR(row.countedCash)}, expected {row.expectedCash === null ? "—" : formatINR(row.expectedCash)}:{" "}
                  <span className={cn("font-semibold", row.variance !== null && !isZero(row.variance) && (isNegative(row.variance) ? "text-loss" : "text-flag"))}>{row.variance === null ? "—" : varianceWords(row.variance)}</span>
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Float {formatINR(row.openingFloat)}, opened {when(row.openedAt)} by {row.openedBy ?? "a staff member"}
                  {row.note ? ` · ${row.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

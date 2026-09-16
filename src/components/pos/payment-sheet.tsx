"use client";

/**
 * Taking the money at the counter.
 *
 * Two steps and no more: what was handed over, then what goes back. The
 * total shown here is the server's — `priceDraftOrder` computed it and this
 * screen only re-reads `totalPaise` to work out change, which is a courtesy
 * for the cashier's hands and never the sale. `placeCounterOrderAction`
 * reprices the whole draft again on the server and takes the cash against
 * its own figure, so a tampered total on this screen buys nothing. §13.
 *
 * Mounted only while a payment is being taken, so every piece of state here
 * — including the idempotency key — begins and ends with one attempt at one
 * order. The key is minted once on mount and reused on every retry, so a
 * double-tap on Confirm, or a tap after the network dropped mid-request,
 * replays the same placement instead of ringing the order up twice. §17.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { Banknote, CheckCircle2, Gift, Loader2, Printer, TriangleAlert } from "lucide-react";
import { formatINR, paise, subtract } from "@/lib/money";
import { STALE_DEPLOYMENT_MESSAGE, isStaleDeploymentError } from "@/lib/errors/stale-deployment";
import type { CounterCheckoutResult, PriceDraftOk } from "@/lib/pos/actions";
import { changeDue, parseTender, quickTenders } from "@/lib/pos/tender";
import type { ReceiptData } from "@/lib/receipt/data";
import type { ReceiptTemplate } from "@/lib/receipt/template";
import { ReceiptSheet } from "@/components/receipt/receipt-sheet";
import { type PrintResult, useLocalPrinter } from "@/components/hardware/device-agent";
import { cn } from "@/lib/utils";
import { type PosCustomer, attachCustomerByPhone } from "./attach-customer";
import { RewardsKeypad } from "./rewards-keypad";

export type { PosCustomer } from "./attach-customer";

export interface SettledOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly total: string;
  readonly received: string;
  readonly change: string | null;
  readonly paid: boolean;
  readonly paymentError: string | null;
  readonly at: string;
  /** The slip, as the server read it back from the order it just wrote. */
  readonly receipt: ReceiptData | null;
}

export function PaymentSheet({
  priced,
  shopName,
  receiptTemplate,
  canDuplicate,
  channelLabel,
  tableName,
  customer,
  onCustomerChange,
  canEnrol,
  onCancel,
  onConfirm,
  onDone,
}: {
  priced: PriceDraftOk;
  shopName: string;
  /** The applied Bill & Receipt design. */
  receiptTemplate: ReceiptTemplate;
  /** `orders.refund` — may print a second copy. */
  canDuplicate: boolean;
  channelLabel: string;
  tableName: string | null;
  customer: PosCustomer | null;
  onCustomerChange: (customer: PosCustomer | null) => void;
  /** `customers.view` — whether the rewards button is offered at all. */
  canEnrol: boolean;
  onCancel: () => void;
  onConfirm: (cashReceived: string, idempotencyKey: string) => Promise<CounterCheckoutResult>;
  onDone: () => void;
}) {
  const [cash, setCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<SettledOrder | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [isPending, startTransition] = useTransition();
  const customerName = customer?.name ?? customer?.phone ?? null;
  const localPrinter = useLocalPrinter();
  const [print, setPrint] = useState<ThermalPrintState>({ state: "idle" });

  /**
   * The receipt to the thermal printer, through this device's bridge. The
   * order is already saved and paid before this runs; a printer that is off
   * changes nothing about the sale — only what this screen says next.
   */
  async function printThermal(order: SettledOrder, kind: "RECEIPT" | "DUPLICATE", jobId?: string) {
    if (!localPrinter?.client.supported || !localPrinter.printer || !order.receipt) return;
    setPrint({ state: "printing", kind });
    const result: PrintResult = await localPrinter.printReceipt({ orderId: order.orderId, template: receiptTemplate, data: order.receipt, kind, jobId });
    if (result.ok) setPrint({ state: "printed", kind, jobId: result.jobId, duplicate: result.duplicate });
    else setPrint({ state: "failed", kind, jobId: result.jobId, error: result.error, retryable: result.retryable });
  }

  /** The keypad's submit: the same lookup as the Customer control at the top of the till, into the same shell state. */
  async function enrol(phone: string): Promise<string | null> {
    const result = await attachCustomerByPhone(phone);
    if (!result.ok) return result.error;
    onCustomerChange(result.customer);
    setEnrolling(false);
    return null;
  }
  // One key for the life of this sheet: minted on mount, so it is the same
  // on the first Confirm and on every retry after it.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Consecutive *unreachable-server* failures on this one Confirm attempt —
   * not business-rule refusals (a short tender, a permission error), which
   * reset it. This app has no error monitoring (`docs/DEPLOY.md`): a network
   * failure used to crash the whole till loudly enough that someone noticed;
   * catching it quietly (below) is correct for the idempotency guarantee but
   * would otherwise leave a genuinely broken server invisible, with the
   * cashier told to keep tapping a button that will never work. After a few
   * in a row, the message below stops suggesting a retry and says to stop.
   */
  const [networkFailures, setNetworkFailures] = useState(0);

  // Deliberately not auto-focused: on a touchscreen till, focusing this
  // field on mount immediately raises the OS numeric keyboard over the
  // payment sheet before the cashier has looked at it. The field is a
  // normal, visible control — tapping it opens the keyboard when the
  // cashier actually wants to type an amount.

  const total = useMemo(() => paise(BigInt(priced.totalPaise)), [priced.totalPaise]);
  const quick = useMemo(() => quickTenders(total), [total]);

  const tendered = parseTender(cash);
  const change = tendered !== null ? changeDue(total, tendered) : null;
  const short = tendered !== null && tendered < total;

  function confirm() {
    if (tendered === null || short) return;
    setError(null);
    startTransition(async () => {
      let result: CounterCheckoutResult;
      try {
        result = await onConfirm(cash.trim(), idempotencyKey);
      } catch (caught) {
        // Unlike a form field losing its draft, an uncaught error here would
        // unmount this sheet via the route's error boundary and take the
        // idempotency key with it — the one piece of state that makes a
        // retry after a dropped connection safe rather than a second charge.
        // So every failure is caught here, not just the stale-deployment one
        // other components special-case: this component never unmounts on a
        // failed Confirm, full stop.
        if (isStaleDeploymentError(caught)) {
          setError(STALE_DEPLOYMENT_MESSAGE);
          return;
        }
        // Genuinely unknown outcome — the request may have reached the
        // server and completed, or may not have reached it at all. Either
        // way the key in this sheet is untouched, so telling the cashier
        // to press Confirm again is honest: it replays this exact attempt
        // if it already went through, or completes it if it didn't. §17.
        const attempt = networkFailures + 1;
        setNetworkFailures(attempt);
        setError(
          attempt >= 3
            ? "Still can't reach the server after several tries. This isn't your connection — stop and get the owner or manager before trying again."
            : "Couldn't reach the server. Press Confirm again — it's safe, the same order can't be taken twice.",
        );
        return;
      }
      setNetworkFailures(0);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const order: SettledOrder = {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        total: result.total,
        received: result.received,
        change: result.change,
        paid: result.paid,
        paymentError: result.paid ? null : result.paymentError,
        at: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
        receipt: result.receipt,
      };
      setSettled(order);
      // Auto print: only on a device with a bridge and a printer set to auto print.
      if (localPrinter?.client.supported && localPrinter.printer?.autoPrintEnabled && result.paid) void printThermal(order, "RECEIPT");
      else if (localPrinter?.client.supported && localPrinter.printer) setPrint({ state: "skipped" });
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={settled ? "Order complete" : enrolling ? "Rewards — add mobile" : "Take payment"}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isPending) return;
        // Escape on the keypad is Cancel: back to the tender, nothing changed.
        if (enrolling) setEnrolling(false);
        else (settled ? onDone : onCancel)();
      }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-xl bg-background p-5 shadow-xl sm:rounded-xl">
        {settled ? (
          <Settled
            settled={settled}
            onDone={onDone}
            onRetry={() => setSettled(null)}
            thermal={localPrinter?.client.supported && localPrinter.printer ? { print, printerName: localPrinter.printer.name, canDuplicate, retry: () => printThermal(settled, "RECEIPT", print.state === "failed" ? (print.jobId ?? undefined) : undefined), duplicate: () => printThermal(settled, "DUPLICATE"), printNow: () => printThermal(settled, "RECEIPT") } : null}
          />
        ) : enrolling ? (
          <RewardsKeypad onCancel={() => setEnrolling(false)} onSubmit={enrol} />
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {[channelLabel, tableName, customerName].filter(Boolean).join(" · ")}
              </span>
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-heading text-lg font-semibold">Amount due</h2>
                <span className="tabular text-3xl font-bold">{priced.total}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {priced.itemCount} {priced.itemCount === 1 ? "item" : "items"}
                {priced.hasTax ? ` · includes ${priced.taxTotal} GST` : ""}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <label htmlFor="pos-cash" className="text-sm font-semibold">
                Cash received
              </label>
              <input
                ref={inputRef}
                id="pos-cash"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={cash}
                onChange={(event) => {
                  setCash(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirm();
                }}
                placeholder="0"
                aria-describedby="pos-change"
                className="tabular h-[64px] w-full rounded-md border border-border-strong bg-surface px-4 text-right text-3xl font-bold outline-none focus:border-primary"
              />

              <div className="grid grid-cols-4 gap-2">
                {quick.map((amount) => (
                  <button
                    key={amount.toString()}
                    type="button"
                    onClick={() => {
                      setCash((Number(amount) / 100).toString());
                      setError(null);
                    }}
                    className="tabular flex min-h-[52px] items-center justify-center rounded-md border border-border bg-surface text-sm font-semibold transition-colors hover:border-border-strong"
                  >
                    {formatINR(amount, "whole")}
                  </button>
                ))}
              </div>
            </div>

            <p
              id="pos-change"
              aria-live="polite"
              className={cn(
                "mt-4 flex items-baseline justify-between gap-4 rounded-md px-3 py-2.5 text-sm",
                short
                  ? "bg-destructive/10 text-destructive"
                  : change !== null
                    ? "bg-success/10"
                    : "bg-surface-muted text-muted-foreground",
              )}
            >
              <span className="font-semibold">{short ? "Short by" : "Change"}</span>
              <span className="tabular text-lg font-bold">
                {short && tendered !== null
                  ? formatINR(subtract(total, tendered))
                  : change !== null
                    ? formatINR(change)
                    : "—"}
              </span>
            </p>

            {/* FRYBIRD REWARDS — optional, customer-initiated, never in the
                way. One secondary button; the default flow ignores it and the
                order goes through in the same taps as before. Once a number
                is on the order it reads back as a chip with a way off. */}
            {canEnrol &&
              (customer ? (
                <div className="mt-3 flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
                  <Gift className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{customer.name ?? customer.phone}</p>
                    <p className="truncate text-xs text-muted-foreground">{customer.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnrolling(true)}
                    disabled={isPending}
                    className="min-h-[36px] rounded-md px-2 text-xs font-semibold underline underline-offset-2 disabled:opacity-50"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => onCustomerChange(null)}
                    disabled={isPending}
                    aria-label="Remove rewards number from this order"
                    className="min-h-[36px] rounded-md px-2 text-xs font-semibold text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEnrolling(true)}
                  disabled={isPending}
                  className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted disabled:opacity-50"
                >
                  <Gift className="size-4" aria-hidden="true" />
                  Rewards · add mobile
                </button>
              ))}

            {error !== null && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isPending}
                className="flex min-h-[56px] flex-1 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={isPending || tendered === null || short}
                className="flex min-h-[56px] flex-[2] items-center justify-center gap-2 rounded-md bg-primary px-4 text-base font-bold text-primary-foreground transition-opacity disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                    Taking payment…
                  </>
                ) : (
                  <>
                    <Banknote className="size-5" aria-hidden="true" />
                    Confirm payment
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {settled !== null &&
        (settled.receipt ? (
          <ReceiptSheet template={receiptTemplate} data={settled.receipt} mode="print" />
        ) : (
          <Receipt settled={settled} priced={priced} shopName={shopName} channelLabel={channelLabel} tableName={tableName} customerName={customerName} />
        ))}
    </div>
  );
}

/**
 * After the cash is in the drawer.
 *
 * The change is the biggest thing on screen because it is the one number
 * the cashier still has to act on. `paid: false` means the order exists but
 * the money was not recorded — said plainly, with the order number, rather
 * than dressed up as success, and with the way out of it: Try again returns
 * to the tender screen carrying the same idempotency key, so confirming a
 * second time replays the placement onto the order that already exists and
 * only the cash capture is retried.
 */
export type ThermalPrintState =
  | { readonly state: "idle" }
  | { readonly state: "skipped" }
  | { readonly state: "printing"; readonly kind: "RECEIPT" | "DUPLICATE" }
  | { readonly state: "printed"; readonly kind: "RECEIPT" | "DUPLICATE"; readonly jobId: string; readonly duplicate: boolean }
  | { readonly state: "failed"; readonly kind: "RECEIPT" | "DUPLICATE"; readonly jobId: string | null; readonly error: string; readonly retryable: boolean };

interface ThermalControls {
  readonly print: ThermalPrintState;
  readonly printerName: string;
  readonly canDuplicate: boolean;
  readonly retry: () => void;
  readonly duplicate: () => void;
  readonly printNow: () => void;
}

/** What the cashier sees about the thermal receipt: printed, not printed with a retry, or nothing when this device has no printer. */
function ThermalStatus({ thermal }: { thermal: ThermalControls }) {
  const { print } = thermal;
  if (print.state === "idle") return null;
  const busy = print.state === "printing";
  return (
    <div role="status" aria-live="polite" className={cn("flex w-full flex-col gap-2 rounded-md border px-3 py-2 text-left text-sm", print.state === "printed" ? "border-success/40 bg-success/10" : print.state === "failed" ? "border-destructive/40 bg-destructive/10" : "border-border bg-surface")}>
      <p className="flex items-center gap-2 font-semibold">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {print.state === "printed" && <CheckCircle2 className="size-4 text-success" aria-hidden="true" />}
        {print.state === "failed" && <TriangleAlert className="size-4 text-destructive" aria-hidden="true" />}
        {print.state === "printing" ? (print.kind === "DUPLICATE" ? "Printing duplicate…" : "Printing receipt…") : print.state === "printed" ? (print.kind === "DUPLICATE" ? "Duplicate printed ✓" : print.duplicate ? "Receipt already printed ✓" : "Receipt Printed ✓") : print.state === "failed" ? "Receipt Not Printed" : "Receipt not printed — auto print is off"}
      </p>
      {/* The cashier gets the plain fact, not an address and a port; the detail is on the Printers page. */}
      {print.state === "failed" && <p className="text-xs text-muted-foreground">{print.retryable ? "The printer did not answer. Check it is switched on and on the shop Wi-Fi, then retry. The order is complete either way." : print.error}</p>}
      <div className="flex flex-wrap gap-2">
        {print.state === "failed" && print.retryable && (
          <button type="button" onClick={thermal.retry} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border-strong bg-background px-3 text-sm font-semibold hover:bg-surface-muted">
            <Printer className="size-4" aria-hidden="true" />
            Retry Print
          </button>
        )}
        {print.state === "skipped" && (
          <button type="button" onClick={thermal.printNow} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border-strong bg-background px-3 text-sm font-semibold hover:bg-surface-muted">
            <Printer className="size-4" aria-hidden="true" />
            Print receipt
          </button>
        )}
        {print.state === "printed" && thermal.canDuplicate && (
          <button type="button" onClick={thermal.duplicate} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-semibold hover:bg-surface-muted">
            <Printer className="size-4" aria-hidden="true" />
            Print Duplicate
          </button>
        )}
      </div>
    </div>
  );
}

function Settled({
  settled,
  onDone,
  onRetry,
  thermal,
}: {
  settled: SettledOrder;
  onDone: () => void;
  onRetry: () => void;
  /** Null when this device has no thermal printer — the browser Print button is what remains. */
  thermal: ThermalControls | null;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {settled.paid ? (
        <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
      ) : (
        <TriangleAlert className="size-10 text-warning" aria-hidden="true" />
      )}

      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-semibold">
          {settled.paid ? "Paid" : "Order placed, payment not recorded"}
        </h2>
        <p className="tabular text-sm text-muted-foreground">Order {settled.orderNumber}</p>
      </div>

      {settled.paid && settled.change !== null ? (
        <div className="w-full rounded-md bg-success/10 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Change to give</p>
          <p className="tabular text-4xl font-bold">{settled.change}</p>
        </div>
      ) : (
        <p role="alert" className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {settled.paymentError ?? "Take the cash on the order screen before the customer leaves."}
        </p>
      )}

      {thermal && <ThermalStatus thermal={thermal} />}

      <dl className="flex w-full flex-col gap-1 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="tabular font-semibold">{settled.total}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Received</dt>
          <dd className="tabular font-semibold">{settled.received}</dd>
        </div>
      </dl>

      <div className="flex w-full gap-2">
        {!settled.paid && (
          <button
            type="button"
            onClick={onRetry}
            className="flex min-h-[56px] flex-1 items-center justify-center rounded-md border border-border-strong px-4 text-sm font-semibold transition-colors hover:bg-surface-muted"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted"
        >
          <Printer className="size-4" aria-hidden="true" />
          Print
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex min-h-[56px] flex-[2] items-center justify-center rounded-md bg-primary px-4 text-base font-bold text-primary-foreground"
        >
          Next order
        </button>
      </div>
    </div>
  );
}

/**
 * The fallback slip, used only if the server could not read the order back
 * for the designed receipt. Normally `ReceiptSheet` prints the design
 * applied on Bill & Receipt.
 *
 * Hidden on screen; `data-print-receipt` is what the print rules in
 * globals.css key off to blank the rest of the page, so a counter printer
 * gets a 58mm slip rather than a screenshot of the till. Every figure is
 * the server's, already formatted — this only lays them out.
 * Not a tax invoice: FRYBIRD is not GST-registered, so no GSTIN is printed
 * and no tax line appears unless the pricing engine actually charged one.
 */
function Receipt({
  settled,
  priced,
  shopName,
  channelLabel,
  tableName,
  customerName,
}: {
  settled: SettledOrder;
  priced: PriceDraftOk;
  shopName: string;
  channelLabel: string;
  tableName: string | null;
  customerName: string | null;
}) {
  return (
    <div
      data-print-receipt=""
      className="hidden print:block print:w-[58mm] print:p-2 print:font-mono print:text-[11px] print:leading-tight print:text-black"
    >
      <p className="text-center text-[14px] font-bold uppercase">{shopName}</p>
      <p className="text-center">Sector 9, Ambala City</p>
      <p className="mt-2 border-t border-dashed border-black pt-1">Order {settled.orderNumber}</p>
      <p>{settled.at}</p>
      <p>{[channelLabel, tableName, customerName].filter(Boolean).join(" · ")}</p>

      <table className="mt-2 w-full border-t border-dashed border-black pt-1">
        <tbody>
          {priced.lines.map((line) => (
            <tr key={line.key} className="align-top">
              <td className="pr-1">
                {line.quantity}× {line.name}
                {line.modifierNames.length > 0 && <div className="pl-3">{line.modifierNames.join(", ")}</div>}
              </td>
              <td className="whitespace-nowrap text-right">{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1 border-t border-dashed border-black pt-1">
        <Row label="Subtotal" value={priced.subtotal} />
        {priced.hasTax && (
          <>
            <Row label="CGST" value={priced.cgst} />
            <Row label="SGST" value={priced.sgst} />
          </>
        )}
        <Row label="TOTAL" value={settled.total} bold />
        <Row label="Cash" value={settled.received} />
        {settled.change !== null && <Row label="Change" value={settled.change} />}
      </div>

      <p className="mt-2 border-t border-dashed border-black pt-1 text-center">Thank you — come again</p>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2", bold && "font-bold")}>
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  );
}

import { varianceWords } from "@/lib/cash/session";
import { formatINR } from "@/lib/money";
import type { ReconciliationDay } from "@/lib/repositories/cash-sessions";
import { cn } from "@/lib/utils";

/**
 * Reconciliation (roadmap 5.3): each day's cash, online money, refunds and net,
 * beside what the tills counted. Every figure is a sum over stored rows; the
 * Razorpay settlement column is not connected yet and says so. Nothing here is
 * a forecast or an estimate.
 */

const dayLabel = (date: string) => new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

export function ReconciliationTable({ days, openSession, periodLabel }: { readonly days: readonly ReconciliationDay[]; readonly openSession: boolean; readonly periodLabel: string }) {
  if (days.length === 0) {
    return <p className="rounded-xl border border-dashed border-border-strong/70 bg-panel px-4 py-10 text-center text-[13px] text-muted-foreground">No money moved {periodLabel.toLowerCase()}.</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-reconciliation="">
      <p className="text-[13px] text-muted-foreground">
        Each row adds up what was captured that day (cash in a till, cash not in any till, cash a rider still carries, and online) and takes off what was refunded. Razorpay settlements are matched once Razorpay is live: not connected yet.
        {openSession ? " A till is open now; it is counted when it closes." : ""}
      </p>
      <ul className="grid gap-3">
        {days.map((day) => (
          <li key={day.date} className="grid gap-2 rounded-lg border border-border bg-panel p-4 text-sm" data-reconciliation-day={day.date}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{dayLabel(day.date)}</h3>
              <p className="tabular font-money text-lg">Net {formatINR(day.net)}</p>
            </div>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cash in a till</dt>
                <dd className="tabular">{formatINR(day.cashInTill)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Online (provider)</dt>
                <dd className="tabular">{formatINR(day.onlineCaptured)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cash not in any till</dt>
                <dd className={cn("tabular", day.cashUnassigned > 0n && "font-semibold text-flag")}>{formatINR(day.cashUnassigned)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cash a rider still carries</dt>
                <dd className={cn("tabular", day.cashWithRiders > 0n && "font-semibold text-flag")}>{formatINR(day.cashWithRiders)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Refunded in cash</dt>
                <dd className="tabular">{formatINR(day.cashRefunded)}</dd>
              </div>
              {day.cashRefundedNoTill > 0n && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">…of it paid with no till open</dt>
                  <dd className="tabular font-semibold text-flag">{formatINR(day.cashRefundedNoTill)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Refunded online</dt>
                <dd className="tabular">{formatINR(day.onlineRefunded)}</dd>
              </div>
            </dl>
            <p className="border-t border-border pt-2 text-[13px] text-muted-foreground">
              {day.sessionsClosed === 0
                ? "No till was closed this day."
                : `${day.sessionsClosed} ${day.sessionsClosed === 1 ? "till" : "tills"} closed: counted ${formatINR(day.counted)}, expected ${formatINR(day.expected)}: ${varianceWords(day.variance)}.`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefundDialog } from "./refund-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ORDER_CHANNEL_LABELS, type OrderChannel } from "@/domain/order-channel";
import { type Paise, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface PaymentRowView {
  readonly id: string;
  readonly orderNumber: string;
  readonly channel: OrderChannel;
  readonly status: "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  readonly method: string;
  readonly provider: string;
  readonly amount: Paise;
  readonly feeAmount: Paise;
  readonly capturedBy: string | null;
  readonly at: string;
  readonly refunded: Paise;
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  NETBANKING: "Net banking",
  WALLET: "Wallet",
  OTHER: "Other",
};

const STATUS_LABELS: Record<PaymentRowView["status"], string> = {
  PENDING: "Pending",
  AUTHORIZED: "Authorised",
  CAPTURED: "Captured",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Part refunded",
};

function statusClass(status: PaymentRowView["status"]): string {
  if (status === "CAPTURED") return "bg-[#3F9D52]/20 text-foreground";
  if (status === "PENDING" || status === "AUTHORIZED") return "bg-warning/20 text-foreground";
  return "bg-surface-muted text-muted-foreground";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * The payments ledger, filterable by method. Same shell as Orders and
 * Customers; the method pills stand in for Orders' status pills. Every
 * figure is the server's — this only slices the rows it was given.
 */
export function PaymentsTable({ payments, canRefund = false }: { payments: readonly PaymentRowView[]; canRefund?: boolean }) {
  const [method, setMethod] = useState<string | "all">("all");
  const [refunding, setRefunding] = useState<PaymentRowView | null>(null);

  const methods = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of payments) counts.set(row.method, (counts.get(row.method) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const filtered = method === "all" ? payments : payments.filter((row) => row.method === method);

  return (
    <div className="flex flex-col gap-4">
      {methods.length > 1 && (
        <div className="max-w-full overflow-x-auto rounded-lg border border-border" role="tablist" aria-label="Filter by payment method">
          <div className="inline-flex divide-x divide-border">
            <button
              type="button"
              role="tab"
              aria-selected={method === "all"}
              onClick={() => setMethod("all")}
              className={cn(
                "whitespace-nowrap px-3.5 py-2 text-sm transition-colors first:rounded-l-lg last:rounded-r-lg",
                method === "all" ? "bg-surface-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              All <span className="tabular text-xs">({payments.length})</span>
            </button>
            {methods.map(([key, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={method === key}
                onClick={() => setMethod(key)}
                className={cn(
                  "whitespace-nowrap px-3.5 py-2 text-sm transition-colors first:rounded-l-lg last:rounded-r-lg",
                  method === key ? "bg-surface-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {METHOD_LABELS[key] ?? key} <span className="tabular text-xs">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Taken by</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Fee</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="hidden text-right sm:table-cell">When</TableHead>
              {canRefund && <TableHead className="w-24" aria-label="Actions" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canRefund ? 8 : 7} className="h-24 whitespace-normal text-center text-muted-foreground">
                  {payments.length === 0 ? "No payments in this period." : "No payments by that method in this period."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="tabular font-semibold">#{row.orderNumber}</span>
                      <span className="text-xs text-muted-foreground">{ORDER_CHANNEL_LABELS[row.channel]}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{METHOD_LABELS[row.method] ?? row.method}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]", statusClass(row.status))}>
                      {STATUS_LABELS[row.status]}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{row.capturedBy ?? "—"}</TableCell>
                  <TableCell className="tabular hidden text-right text-muted-foreground lg:table-cell">
                    {row.feeAmount === 0n ? "—" : formatINR(row.feeAmount)}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">{formatINR(row.amount)}</TableCell>
                  <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{formatWhen(row.at)}</TableCell>
                  {canRefund && (
                    <TableCell className="text-right">
                      {(row.status === "CAPTURED" || row.status === "PARTIALLY_REFUNDED") && row.amount > row.refunded && (
                        <Button variant="outline" size="sm" onClick={() => setRefunding(row)}>
                          Refund
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <RefundDialog
        open={refunding !== null}
        onOpenChange={(open) => {
          if (!open) setRefunding(null);
        }}
        payment={refunding ? { id: refunding.id, orderNumber: refunding.orderNumber, amount: refunding.amount, refunded: refunding.refunded, provider: refunding.provider, method: refunding.method } : null}
      />
    </div>
  );
}

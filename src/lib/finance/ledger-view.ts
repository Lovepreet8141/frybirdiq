/**
 * Read-only shapes over the payments ledger for the Finance screen.
 *
 * Every figure here is a regrouping of rows `getPaymentsLedger` already
 * returned — captured payments bucketed by business day, the method split
 * as shares, the ledger as CSV. Nothing is a new definition of revenue,
 * fees or refunds, and nothing here reads the database.
 */

import { businessDate } from "@/lib/dates";
import { type Paise, ZERO, add, formatAmount, formatBps, ratioBps } from "@/lib/money";

export type PaymentMethod = "UPI" | "CASH" | "CARD" | "NETBANKING" | "WALLET" | "OTHER";
export type PaymentStatus = "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export const METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  UPI: "UPI",
  CASH: "Cash",
  CARD: "Card",
  NETBANKING: "Net banking",
  WALLET: "Wallet",
  OTHER: "Other",
};

export const STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  PENDING: "Pending",
  AUTHORIZED: "Authorised",
  CAPTURED: "Captured",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Part refunded",
};

/** Cash is the one method with no gateway record; everything else arrives through a provider. */
export type Till = "cash" | "online";

export function tillOf(method: PaymentMethod): Till {
  return method === "CASH" ? "cash" : "online";
}

export interface LedgerPayment {
  readonly status: PaymentStatus;
  readonly method: PaymentMethod;
  readonly amount: Paise;
  readonly at: Date;
}

export interface CapturedDay {
  readonly date: string;
  readonly cash: Paise;
  readonly online: Paise;
  readonly total: Paise;
}

/** Captured payments per business day, one point per day in `days` (a quiet day is a zero, not a gap). */
export function capturedByDay(payments: readonly LedgerPayment[], days: readonly string[]): readonly CapturedDay[] {
  const cash = new Map<string, Paise>();
  const online = new Map<string, Paise>();
  for (const payment of payments) {
    if (payment.status !== "CAPTURED") continue;
    const day = businessDate(payment.at);
    const bucket = tillOf(payment.method) === "cash" ? cash : online;
    bucket.set(day, add(bucket.get(day) ?? ZERO, payment.amount));
  }
  return days.map((date) => {
    const c = cash.get(date) ?? ZERO;
    const o = online.get(date) ?? ZERO;
    return { date, cash: c, online: o, total: add(c, o) };
  });
}

export interface MethodShare {
  readonly method: PaymentMethod;
  readonly label: string;
  readonly count: number;
  readonly total: Paise;
  /** 0–1 share of everything captured. */
  readonly share: number;
  readonly shareLabel: string;
}

export function methodShares(byMethod: readonly { method: PaymentMethod; count: number; total: Paise }[], capturedTotal: Paise): readonly MethodShare[] {
  return byMethod.map((row) => {
    const bps = capturedTotal > ZERO ? ratioBps(row.total, capturedTotal) : 0;
    return { method: row.method, label: METHOD_LABELS[row.method], count: row.count, total: row.total, share: bps / 10_000, shareLabel: capturedTotal > ZERO ? formatBps(bps, 0) : "—" };
  });
}

export interface TillSplit {
  readonly cash: Paise;
  readonly online: Paise;
  /** Cash as a share of everything captured, in basis points; null when nothing was captured. */
  readonly cashBps: number | null;
}

export function tillSplit(byMethod: readonly { method: PaymentMethod; total: Paise }[]): TillSplit {
  const cash = add(...byMethod.filter((row) => tillOf(row.method) === "cash").map((row) => row.total));
  const online = add(...byMethod.filter((row) => tillOf(row.method) === "online").map((row) => row.total));
  const whole = add(cash, online);
  return { cash, online, cashBps: whole > ZERO ? ratioBps(cash, whole) : null };
}

export interface CsvPayment {
  readonly orderNumber: string;
  readonly channel: string;
  readonly status: PaymentStatus;
  readonly method: PaymentMethod;
  readonly provider: string;
  readonly amount: Paise;
  readonly feeAmount: Paise;
  readonly refunded: Paise;
  readonly capturedBy: string | null;
  readonly at: Date;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Rupees with two decimals and no grouping — "2800.00" — so a spreadsheet reads a number, not text. */
function csvRupees(amount: Paise): string {
  return formatAmount(amount, "unit").replaceAll(",", "");
}

/** One line per payment, amounts as rupees with paise, ISO timestamps in UTC — what a spreadsheet reads without guessing. */
export function paymentsCsv(rows: readonly CsvPayment[]): string {
  const header = ["Order", "Channel", "Status", "Method", "Provider", "Amount (INR)", "Fee (INR)", "Refunded (INR)", "Taken by", "At (UTC)"];
  const lines = rows.map((row) =>
    [
      row.orderNumber,
      row.channel,
      STATUS_LABELS[row.status],
      METHOD_LABELS[row.method],
      row.provider,
      csvRupees(row.amount),
      csvRupees(row.feeAmount),
      csvRupees(row.refunded),
      row.capturedBy ?? "",
      row.at.toISOString(),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\n");
}

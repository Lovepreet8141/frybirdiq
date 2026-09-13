"use client";

import type { PrinterStatus } from "@/lib/hardware/printer/types";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<PrinterStatus, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  CONNECTING: "Connecting",
  ERROR: "Error",
  UNKNOWN: "Not checked yet",
  UNAVAILABLE: "Unavailable",
};

const DOT: Record<PrinterStatus, string> = {
  ONLINE: "bg-success",
  OFFLINE: "bg-destructive",
  CONNECTING: "bg-warning",
  ERROR: "bg-destructive",
  UNKNOWN: "bg-muted-foreground/50",
  UNAVAILABLE: "bg-muted-foreground/50",
};

/** A dot and a word. The word is only ever a status a device actually reported. */
export function StatusDot({ status, label, className }: { status: PrinterStatus; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", DOT[status])} aria-hidden="true" />
      <span>{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}

/** The cashier's view: ready, offline, or nothing to say. No addresses, no ports. */
export function PrinterReadyPill({ status, configured }: { status: PrinterStatus; configured: boolean }) {
  if (status === "UNAVAILABLE" || !configured) return null;
  const ready = status === "ONLINE";
  const busy = status === "CONNECTING" || status === "UNKNOWN";
  return (
    <span className={cn("inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", ready ? "border-success/40 bg-success/10 text-foreground" : busy ? "border-border bg-surface text-muted-foreground" : "border-destructive/40 bg-destructive/10 text-foreground")} role="status" aria-live="polite">
      <span className={cn("size-2 rounded-full", ready ? "bg-success" : busy ? "bg-warning" : "bg-destructive")} aria-hidden="true" />
      {ready ? "Printer Ready" : busy ? "Checking printer…" : "Printer Offline"}
    </span>
  );
}

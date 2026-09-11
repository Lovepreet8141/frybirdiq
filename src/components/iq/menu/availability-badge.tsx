import type { AvailabilityStatus } from "@/domain/menu-availability";
import { cn } from "@/lib/utils";

const LABELS: Record<AvailabilityStatus, string> = {
  AVAILABLE: "Live",
  SOLD_OUT_TODAY: "Sold out",
  TEMPORARILY_UNAVAILABLE: "Unavailable",
  SCHEDULED_UNAVAILABLE: "Scheduled",
};

/**
 * The one badge every product row/card shows — archived (`isActive: false`)
 * outranks whatever the availability engine resolved, since an archived
 * item is off the menu entirely, not just 86'd for today.
 */
export function AvailabilityBadge({ status, isActive, className }: { status: AvailabilityStatus; isActive: boolean; className?: string }) {
  if (!isActive) {
    return <span className={cn("inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground", className)}>Archived</span>;
  }

  const tone =
    status === "AVAILABLE"
      ? "bg-[var(--success)]/15 text-[var(--success)]"
      : status === "SCHEDULED_UNAVAILABLE"
        ? "bg-[var(--warning)]/15 text-[var(--warning)]"
        : "bg-[var(--destructive)]/15 text-[var(--destructive)]";

  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", tone, className)}>{LABELS[status]}</span>;
}

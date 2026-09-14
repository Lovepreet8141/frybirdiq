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
 * item is off the menu entirely, not just 86'd for today. Tones are the IQ
 * signal tokens: gain for live, flag for scheduled, loss for off.
 */
export function AvailabilityBadge({ status, isActive, className }: { status: AvailabilityStatus; isActive: boolean; className?: string }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]";
  if (!isActive) {
    return <span className={cn(base, "bg-muted text-muted-foreground", className)}>Archived</span>;
  }

  const tone = status === "AVAILABLE" ? "bg-gain-soft text-gain" : status === "SCHEDULED_UNAVAILABLE" ? "bg-flag-soft text-flag" : "bg-loss-soft text-loss";

  return <span className={cn(base, tone, className)}>{LABELS[status]}</span>;
}

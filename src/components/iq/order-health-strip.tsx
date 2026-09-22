import type { HealthCounts } from "@/lib/kitchen/tickets";
import { cn } from "@/lib/utils";

/**
 * GREEN / AMBER / RED counts from the roadmap 4.1 prep-target rule (roadmap 4.3). A plain server component — every
 * number is read once at render time, same as the rest of the Command Center; no client state, no second source of
 * truth for the thresholds, which live only in `prepHealth`.
 */
export function OrderHealthStrip({ counts, className }: { counts: HealthCounts; className?: string }) {
  const total = counts.green + counts.amber + counts.red;

  if (total === 0) {
    return (
      <p className={cn("text-[13px] text-muted-foreground", className)} role="status">
        Nothing in the kitchen right now.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5", className)} role="group" aria-label="Order health: on track, nearly late, and late counts">
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        <span className="size-2 rounded-full bg-gain" aria-hidden="true" />
        <span className="tabular font-semibold text-gain">{counts.green}</span>
        <span className="text-muted-foreground">on track</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        <span className="size-2 rounded-full bg-flag" aria-hidden="true" />
        <span className="tabular font-semibold text-flag">{counts.amber}</span>
        <span className="text-muted-foreground">nearly late</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        <span className="size-2 rounded-full bg-loss" aria-hidden="true" />
        <span className="tabular font-semibold text-loss">{counts.red}</span>
        <span className="text-muted-foreground">late</span>
      </span>
    </div>
  );
}

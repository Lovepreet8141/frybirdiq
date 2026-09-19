import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Limited data" — on an insight card whenever a readiness score it rests on is
 * under 80% (or has no data yet). Words first, icon second, never colour alone.
 * The reasons are named in full so the owner can see which record-keeping gap
 * to close; they are facts from `getReadiness`, not judgements made here.
 */
export function LimitedBadge({ reasons, className }: { readonly reasons: readonly string[]; readonly className?: string }) {
  if (reasons.length === 0) return null;
  return (
    <p
      data-limited-badge=""
      title={reasons.join("\n")}
      className={cn("inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-flag-soft px-2 py-0.5 text-xs font-semibold text-flag", className)}
    >
      <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
      <span>Limited data</span>
      <span className="sr-only">: {reasons.join("; ")}</span>
    </p>
  );
}

import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Limited data" — on an insight card whenever a readiness score it rests on is
 * under 80% (or has no data yet). Words first, icon second, never colour alone.
 * Each reason is printed as visible text (a phone has no hover), one line per
 * weak score, so the owner can see which record-keeping gap to close. They are
 * facts from `getReadiness`, not judgements made here.
 */
export function LimitedBadge({ reasons, className }: { readonly reasons: readonly string[]; readonly className?: string }) {
  if (reasons.length === 0) return null;
  return (
    <div data-limited-badge="" className={cn("flex w-fit max-w-full flex-col gap-0.5 rounded-lg bg-flag-soft px-2.5 py-1 text-xs text-flag", className)}>
      <p className="inline-flex items-center gap-1 font-semibold">
        <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
        Limited data
      </p>
      <ul className="font-medium">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

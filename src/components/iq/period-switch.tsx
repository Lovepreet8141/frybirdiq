import Link from "next/link";
import { ButtonGroup } from "@/components/ui/button-group";
import type { RangeKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface PeriodOption {
  readonly key: RangeKey;
  readonly label: string;
}

/**
 * The period control every report shares — the purchased `button-group3`
 * (Days / Months / Years) as a fused group of links. Links, not buttons:
 * each period is a `?range=` the server resolves through `resolveRange`,
 * so switching re-runs the page's own queries rather than re-slicing
 * anything on the client. The same figures, the same rules, one control.
 */
export function PeriodSwitch({ basePath, options, current, params, className }: { basePath: string; options: readonly PeriodOption[]; current: RangeKey; params?: Readonly<Record<string, string | undefined>>; className?: string }) {
  const extra = Object.entries(params ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")
    .map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("");
  return (
    <ButtonGroup aria-label="Period" className={cn("max-w-full overflow-x-auto", className)}>
      {options.map((option) => {
        const active = option.key === current;
        return (
          <Link
            key={option.key}
            href={`${basePath}?range=${option.key}${extra}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 shrink-0 items-center border border-border px-3.5 text-[13px] transition-colors duration-[120ms] md:h-8",
              active ? "bg-secondary font-semibold text-foreground" : "bg-panel font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </ButtonGroup>
  );
}

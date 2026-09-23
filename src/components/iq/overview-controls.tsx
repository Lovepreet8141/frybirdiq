"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OVERVIEW_RANGES, type CompareOption, type OverviewRange } from "@/lib/iq/overview";
import { cn } from "@/lib/utils";

/**
 * The Overview's controls: the range (a segmented control), the comparison
 * (a menu), and — only once the shop has an Opening date — the pre-launch
 * toggle (`analytics-start-date`). All three live in the URL, so a link to
 * "7 days vs the 4-week average, pre-launch data included" is a link, and
 * the server renders the page for it; changing one control preserves the
 * others.
 *
 * A comparison the data cannot support is shown, disabled, with the
 * reason — "Needs 4 weeks of history · Store opened 8 Aug 2026" — rather
 * than hidden, so the owner knows what will unlock and when.
 */
export function OverviewControls({
  range,
  compare,
  options,
  includePreLaunch,
  showPreLaunchToggle,
}: {
  range: OverviewRange;
  compare: CompareOption | null;
  options: readonly CompareOption[];
  /** Whether pre-launch data (recorded before the shop's Opening date) is currently included. */
  includePreLaunch: boolean;
  /** Only true once an Opening date is set — with nothing to exclude, the toggle would do nothing. */
  showPreLaunchToggle: boolean;
}) {
  const router = useRouter();
  const go = (nextRange: OverviewRange, nextCompare: string | null, nextIncludePreLaunch: boolean) => {
    const params = new URLSearchParams();
    params.set("range", nextRange);
    if (nextCompare) params.set("vs", nextCompare);
    if (nextIncludePreLaunch) params.set("includePreLaunch", "1");
    router.push(`/app/iq?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <nav aria-label="Period" className="inline-flex max-w-full overflow-x-auto rounded-[10px] border border-border bg-panel p-1">
        {OVERVIEW_RANGES.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-current={option.key === range ? "page" : undefined}
            onClick={() => go(option.key, compare?.key ?? null, includePreLaunch)}
            className={cn(
              "flex min-h-[44px] items-center whitespace-nowrap rounded-[7px] px-3.5 text-[13px] transition-colors duration-[120ms] md:min-h-0 md:h-8",
              option.key === range ? "bg-secondary font-semibold text-secondary-foreground" : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 rounded-[10px] px-3 text-[13px] font-normal text-muted-foreground md:h-10">
            vs <span className="font-semibold text-foreground">{compare ? compare.label.toLowerCase() : "no comparison"}</span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[320px] p-1.5">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.key}
              disabled={!option.available}
              onSelect={() => option.available && go(range, option.key, includePreLaunch)}
              className={cn("flex flex-col items-start gap-0.5 rounded-[7px] px-2.5 py-2", option.key === compare?.key && "bg-surface-muted font-semibold")}
            >
              <span className="flex w-full items-center justify-between gap-3 text-sm">
                <span>{option.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{option.available ? (option.key === compare?.key ? "Selected" : "") : "Unavailable"}</span>
              </span>
              <span className="text-xs font-normal text-muted-foreground">{option.available ? option.note : `${option.note} · ${option.reason}`}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {showPreLaunchToggle && (
        <label className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-border bg-panel px-3 text-[13px] text-muted-foreground">
          <input type="checkbox" checked={includePreLaunch} onChange={(event) => go(range, compare?.key ?? null, event.target.checked)} className="size-4 accent-foreground" />
          Include pre-launch data
        </label>
      )}
    </div>
  );
}

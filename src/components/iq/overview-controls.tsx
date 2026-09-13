"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OVERVIEW_RANGES, type CompareOption, type OverviewRange } from "@/lib/iq/overview";
import { cn } from "@/lib/utils";

/**
 * The Overview's two controls: the range (a segmented control) and the
 * comparison (a menu). Both live in the URL, so a link to "7 days vs the
 * 4-week average" is a link, and the server renders the page for it.
 *
 * A comparison the data cannot support is shown, disabled, with the
 * reason — "Needs 4 weeks of history · Store opened 8 Aug 2026" — rather
 * than hidden, so the owner knows what will unlock and when.
 */
export function OverviewControls({ range, compare, options }: { range: OverviewRange; compare: CompareOption | null; options: readonly CompareOption[] }) {
  const router = useRouter();
  const go = (nextRange: OverviewRange, nextCompare: string | null) => {
    const params = new URLSearchParams();
    params.set("range", nextRange);
    if (nextCompare) params.set("vs", nextCompare);
    router.push(`/app/iq?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <nav aria-label="Period" className="inline-flex max-w-full overflow-x-auto rounded-[10px] border border-border bg-surface p-1">
        {OVERVIEW_RANGES.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-current={option.key === range ? "page" : undefined}
            onClick={() => go(option.key, compare?.key ?? null)}
            className={cn(
              "flex min-h-[44px] items-center whitespace-nowrap rounded-[7px] px-3.5 text-sm md:min-h-0 md:h-8",
              option.key === range ? "bg-secondary font-semibold text-secondary-foreground" : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 rounded-[10px] bg-surface px-3 text-sm font-normal text-muted-foreground md:h-10">
            vs <span className="font-semibold text-foreground">{compare ? compare.label.toLowerCase() : "no comparison"}</span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[320px] p-1.5">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.key}
              disabled={!option.available}
              onSelect={() => option.available && go(range, option.key)}
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
    </div>
  );
}

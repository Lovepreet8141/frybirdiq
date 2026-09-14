import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBps } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface KpiCompactProps {
  readonly label: string;
  /** The figure, already formatted; "—" with `missing` when there is no honest number. */
  readonly value: string;
  /** Basis points vs the comparison; null = nothing to compare against. */
  readonly deltaBps?: number | null;
  /** Lower is better. */
  readonly deltaInverted?: boolean;
  readonly note: string;
  readonly href: string;
  readonly linkLabel: string;
  readonly missing?: boolean;
  readonly emphasis?: boolean;
  readonly className?: string;
}

/**
 * The purchased Sales dashboard's compact KPI card (`sales/components/balance-card.tsx`)
 * with the trend badge the Website-analytics `StatCards` put in `CardAction`:
 * title, a badge only when a real comparison exists, the figure at the
 * kit's `text-2xl lg:text-3xl`, one line of context, and the whole card a
 * link to where the number is explained. Never a percentage without a base.
 */
export function KpiCompact({ label, value, deltaBps, deltaInverted = false, note, href, linkLabel, missing = false, emphasis = false, className }: KpiCompactProps) {
  const up = deltaBps !== null && deltaBps !== undefined && deltaBps > 0;
  const down = deltaBps !== null && deltaBps !== undefined && deltaBps < 0;
  const good = deltaInverted ? down : up;
  return (
    <Card size="sm" className={cn("h-full", emphasis && "bg-panel shadow-[0_1px_0_rgba(25,21,18,0.04)]", className)}>
      <CardHeader className="pb-1.5">
        <CardTitle className="text-[13px] font-medium text-muted-foreground">{label}</CardTitle>
        {deltaBps !== undefined && deltaBps !== null && !missing && (
          <CardAction>
            <Badge variant={deltaBps === 0 ? "secondary" : good ? "success" : "destructive"} className="tabular">
              {up ? <TrendingUp aria-hidden="true" /> : down ? <TrendingDown aria-hidden="true" /> : null}
              <span className="sr-only">{up ? "Up" : down ? "Down" : "Unchanged"} </span>
              {up ? "+" : down ? "−" : ""}
              {formatBps(Math.abs(deltaBps), 1)}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className={cn("tabular font-money text-2xl leading-none tracking-[-0.01em] lg:text-[28px]", missing && "text-muted-foreground/70")}>{missing ? "—" : value}</div>
        <p className="text-[12.5px] leading-[1.4] text-muted-foreground">{note}</p>
        <Link href={href} className="mt-auto inline-flex items-center gap-1 pt-2 text-[12px] font-semibold text-foreground underline-offset-2 hover:underline">
          {linkLabel}
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

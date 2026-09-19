import Link from "next/link";
import { ArrowRight, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LIMITED_BELOW_PERCENT, type Readiness, type Score, STOCK_COUNT_RED_DAYS } from "@/lib/iq/readiness/scores";
import { cn } from "@/lib/utils";

/**
 * IQ READINESS — one read-only card: an overall percent, the single most useful
 * action for today, and five scores, each a percent of stored rows with its
 * trend against the week before. Every figure comes from `getReadiness`; this
 * component only lays it out. It changes nothing and forecasts nothing.
 */

function Trend({ points }: { readonly points: number | null }) {
  if (points === null) return <span className="text-muted-foreground">no earlier week to compare</span>;
  if (points === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="size-3" aria-hidden="true" />
        same as last week
      </span>
    );
  }
  const up = points > 0;
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", up ? "text-gain" : "text-loss")}>
      {up ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" />}
      {up ? "up" : "down"} {Math.abs(points)} {Math.abs(points) === 1 ? "point" : "points"} on last week
    </span>
  );
}

function Row({ score }: { readonly score: Score }) {
  const percent = score.percent;
  const limited = score.state !== "ok";
  return (
    <li className="grid gap-1.5 border-t border-border py-3 first:border-t-0 first:pt-0" data-readiness-score={score.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[13px] font-medium">{score.label}</span>
        <span className="tabular font-money text-lg leading-none">{percent === null ? "No data yet" : `${percent}%`}</span>
      </div>
      <div
        role="progressbar"
        aria-label={score.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? "no data yet" : `${percent} percent`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", limited ? "bg-flag" : "bg-gain")} style={{ width: `${percent ?? 0}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[12.5px] text-muted-foreground">
        <span>
          {score.denominator === 0 ? "Nothing to measure yet" : `${score.numerator} of ${score.denominator}`}
          {limited ? ` · under ${LIMITED_BELOW_PERCENT}%: insights that rely on it are marked limited` : ""}
        </span>
        <Trend points={score.trendPoints} />
      </div>
      {score.id === "stockCount" && (
        <p className={cn("text-[12.5px]", score.red ? "font-semibold text-loss" : "text-muted-foreground")}>
          {score.daysSinceLastCount === null
            ? "Red: no stock count on record."
            : `${score.red ? `Red: last counted ${score.daysSinceLastCount} days ago (over ${STOCK_COUNT_RED_DAYS}).` : `Last counted ${score.daysSinceLastCount === 0 ? "today" : `${score.daysSinceLastCount} ${score.daysSinceLastCount === 1 ? "day" : "days"} ago`}.`}`}
        </p>
      )}
      <p className="text-[12px] leading-snug text-muted-foreground/90">{score.definition}</p>
    </li>
  );
}

export function ReadinessPanel({ readiness, className }: { readonly readiness: Readiness; readonly className?: string }) {
  const { overallPercent, basedOn, action, scores } = readiness;
  return (
    <Card className={cn("h-full", className)} data-iq-readiness="">
      <CardHeader>
        <CardTitle>IQ readiness</CardTitle>
        <CardDescription>How much of your own record-keeping the numbers can lean on · last 7 finished days · counted from stored records</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,15rem)_1fr] lg:gap-8">
        <div className="flex flex-col gap-3">
          <div>
            <div className="tabular font-money text-5xl leading-none tracking-[-0.02em]">{overallPercent === null ? "—" : `${overallPercent}%`}</div>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              {overallPercent === null ? "Not enough recorded data to score yet." : `Average of ${basedOn} of 5 scores${basedOn < 5 ? " (the rest have no data yet)" : ""}.`}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3 text-[13px]" data-readiness-action="">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Today&apos;s action</p>
            {action ? (
              <>
                <p className="mt-1 leading-snug">{action.text}</p>
                <Link href={action.href} className="mt-2 inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold underline underline-offset-2">
                  Go there
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </>
            ) : (
              <p className="mt-1 leading-snug">{overallPercent === null ? "Nothing to score yet: keep recording orders, cash and stock counts." : "No action needed today."}</p>
            )}
          </div>
        </div>
        <ul className="flex flex-col">
          {scores.map((score) => (
            <Row key={score.id} score={score} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatBps } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A headline figure.
 *
 * A stat tile rather than a chart: one number over one period has no shape to
 * plot, and a sparkline behind a single value is decoration.
 *
 * The delta never relies on colour. It carries an arrow, a sign and the word
 * for what it is compared against — green and red are the last signal, not the
 * only one.
 */
export function Delta({
  changeBps,
  comparedTo,
  inverted = false,
}: {
  changeBps: number;
  comparedTo?: string;
  inverted?: boolean;
}) {
  const flat = changeBps === 0;
  const up = changeBps > 0;
  const good = inverted ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <span className={cn("tabular inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-xs font-semibold", flat ? "bg-muted text-muted-foreground" : good ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss")}>
        <Icon className="size-3.5" aria-hidden="true" />
        {/* The sign is written, so the direction survives a greyscale print and
            a colourblind reader. */}
        {up ? "+" : ""}
        {formatBps(changeBps, 1)}
      </span>
      {comparedTo && <span>vs {comparedTo}</span>}
    </p>
  );
}

export function StatTile({
  label,
  value,
  changeBps,
  comparedTo,
  detail,
  /** A second comparison alongside the first — "vs yesterday" next to "vs last week". */
  secondaryChangeBps,
  secondaryComparedTo,
  /** True when a rise is bad — an unpaid balance, a refund total. */
  inverted = false,
}: {
  label: string;
  value: string;
  changeBps?: number | null;
  comparedTo?: string;
  detail?: string;
  secondaryChangeBps?: number | null;
  secondaryComparedTo?: string;
  inverted?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <p className="tabular font-money text-[32px] leading-none tracking-[-0.01em]">{value}</p>

        {typeof changeBps === "number" ? (
          <Delta changeBps={changeBps} comparedTo={comparedTo} inverted={inverted} />
        ) : (
          /* No base to compare against. "+100%" from zero is a number that means
             nothing, so nothing is shown. */
          <p className="text-[13px] text-muted-foreground">{detail ?? "No earlier period to compare"}</p>
        )}

        {typeof secondaryChangeBps === "number" && (
          <Delta changeBps={secondaryChangeBps} comparedTo={secondaryComparedTo} inverted={inverted} />
        )}

        {detail && typeof changeBps === "number" && <p className="text-sm text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}

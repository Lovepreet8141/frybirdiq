import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
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
function Delta({
  changeBps,
  comparedTo,
  inverted,
}: {
  changeBps: number;
  comparedTo?: string;
  inverted: boolean;
}) {
  const flat = changeBps === 0;
  const up = changeBps > 0;
  const good = inverted ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <p
      className={cn(
        "tabular flex items-center gap-1 text-sm font-semibold",
        flat ? "text-muted-foreground" : good ? "text-[var(--success)]" : "text-[var(--destructive)]",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {/* The sign is written, so the direction survives a greyscale print and
          a colourblind reader. */}
      {up ? "+" : ""}
      {formatBps(changeBps, 1)}
      {comparedTo && <span className="font-normal text-muted-foreground"> vs {comparedTo}</span>}
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
    <div className="flex flex-col gap-1.5 bg-surface px-5 py-5">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="tabular font-heading text-3xl font-bold leading-none">{value}</p>

      {typeof changeBps === "number" ? (
        <Delta changeBps={changeBps} comparedTo={comparedTo} inverted={inverted} />
      ) : (
        /* No base to compare against. "+100%" from zero is a number that means
           nothing, so nothing is shown. */
        <p className="text-sm text-muted-foreground">{detail ?? "No earlier period to compare"}</p>
      )}

      {typeof secondaryChangeBps === "number" && (
        <Delta changeBps={secondaryChangeBps} comparedTo={secondaryComparedTo} inverted={inverted} />
      )}

      {detail && typeof changeBps === "number" && <p className="text-sm text-muted-foreground">{detail}</p>}
    </div>
  );
}

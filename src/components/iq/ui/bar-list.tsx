import { cn } from "@/lib/utils";

/**
 * "Where money goes": a label, a bar as a share of the whole, the share and
 * the amount. Bars draw in the warm neutral ramp; the one row that is a
 * gain (kept as profit) draws in gain. Text carries every figure, so the
 * bar is a shape, not the only signal.
 */
export interface BarRow {
  readonly key: string;
  readonly label: string;
  /** 0–1 share of the whole; the bar length. */
  readonly share: number;
  readonly shareLabel: string;
  readonly amount: string;
  readonly tone?: "ramp" | "gain" | "loss" | "muted";
  readonly bold?: boolean;
}

const FILL = { ramp: "bg-ramp-4", gain: "bg-gain", loss: "bg-loss", muted: "bg-ramp-5" } as const;

export function BarList({ rows, className }: { rows: readonly BarRow[]; className?: string }) {
  const max = Math.max(0.0001, ...rows.map((row) => row.share));
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {rows.map((row) => (
        <li key={row.key} className={cn("grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_52px_minmax(72px,auto)] items-center gap-3 text-[13px]", row.bold && "font-semibold")}>
          <span className="truncate text-foreground/90">{row.label}</span>
          <span className="h-[7px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className={cn("block h-full rounded-full", FILL[row.tone ?? "ramp"])} style={{ width: `${Math.max(2, (row.share / max) * 100)}%` }} />
          </span>
          <span className="tabular text-right text-muted-foreground">{row.shareLabel}</span>
          <span className="tabular text-right">{row.amount}</span>
        </li>
      ))}
    </ul>
  );
}

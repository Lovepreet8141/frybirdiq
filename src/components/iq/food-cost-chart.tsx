import { type Bps, type Paise, formatBps, formatINR } from "@/lib/money";

export interface FoodCostPoint {
  readonly weekStart: string;
  readonly weekLabel: string;
  readonly revenue: Paise;
  readonly directCost: Paise;
  readonly foodCostBps: Bps | null;
}

/**
 * Food cost % by week, with an optional dashed target.
 *
 * A line, not bars: this is a ratio moving over time, and the question is
 * "is it drifting" rather than "which week was biggest". The axis is scaled to
 * the data plus the target rather than 0–100 — a series that lives between 28%
 * and 34% is a flat line worth reading on a 0–100 scale and a legible one on
 * its own.
 *
 * `targetBps` is null until an owner sets one. No line is drawn rather than a
 * guessed target — a dashed line at an invented 30% would read as the owner's
 * own goal.
 */
export function FoodCostChart({
  points,
  targetBps,
  className,
}: {
  points: readonly FoodCostPoint[];
  targetBps: Bps | null;
  className?: string;
}) {
  const known = points.filter((p): p is FoodCostPoint & { foodCostBps: Bps } => p.foodCostBps !== null);
  if (known.length === 0) return null;

  const values = known.map((p) => p.foodCostBps / 100);
  const withTarget = targetBps === null ? values : [...values, targetBps / 100];
  const rawMin = Math.min(...withTarget);
  const rawMax = Math.max(...withTarget);
  // Round out to the nearest 2 points and pad, so the line never touches the
  // frame and a flat week doesn't look like it grazed the target.
  const min = Math.max(0, Math.floor((rawMin - 2) / 2) * 2);
  const max = Math.ceil((rawMax + 2) / 2) * 2;
  const span = Math.max(max - min, 1);

  const width = 100;
  const height = 34;
  const slot = points.length > 1 ? width / (points.length - 1) : 0;
  const y = (pct: number) => height - ((pct - min) / span) * height;

  const linePath = points
    .map((p, i) => (p.foodCostBps === null ? null : `${i * slot},${y(p.foodCostBps / 100)}`))
    .reduce<string[]>((segments, coord, i) => {
      if (coord === null) return segments;
      const prevKnown = i > 0 && points[i - 1]!.foodCostBps !== null;
      segments.push(`${prevKnown ? "L" : "M"}${coord}`);
      return segments;
    }, [])
    .join(" ");

  const latest = known[known.length - 1]!;
  const overTarget = targetBps !== null && latest.foodCostBps > targetBps;

  const labelled = new Set([0, points.length - 1]);

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Food cost by week. Most recent week ${formatBps(latest.foodCostBps, 1)}.${
          targetBps !== null ? ` Target ${formatBps(targetBps, 1)}.` : ""
        }`}
      >
        {targetBps !== null && (
          <>
            <line
              x1="0"
              y1={y(targetBps / 100)}
              x2={width}
              y2={y(targetBps / 100)}
              stroke="var(--border-strong)"
              strokeWidth="0.4"
              strokeDasharray="1.6 1.2"
              vectorEffect="non-scaling-stroke"
            />
            <text x={width} y={y(targetBps / 100) - 1} textAnchor="end" fontSize="3.2" fill="var(--muted-foreground)">
              Target {formatBps(targetBps, 0)}
            </text>
          </>
        )}

        <path
          d={linePath}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="0.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {points.map((p, i) =>
          p.foodCostBps === null ? null : (
            <circle key={p.weekStart} cx={i * slot} cy={y(p.foodCostBps / 100)} r="0.9" fill="var(--primary)">
              <title>
                {p.weekLabel} — {formatBps(p.foodCostBps, 1)} food cost on {formatINR(p.revenue, "whole")} revenue
              </title>
            </circle>
          ),
        )}
      </svg>

      <figcaption className="mt-2 flex justify-between text-xs text-muted-foreground">
        {points.map((p, i) => (labelled.has(i) ? <span key={p.weekStart}>{p.weekLabel}</span> : null))}
      </figcaption>

      <p className="tabular mt-3 text-sm">
        Most recent week: <strong className={overTarget ? "text-destructive" : "text-foreground"}>{formatBps(latest.foodCostBps, 1)}</strong>
        {targetBps !== null && (
          <span className="text-muted-foreground"> against a target of {formatBps(targetBps, 1)}</span>
        )}
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">See the figures</summary>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-1.5 font-semibold">Week</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Revenue</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Direct cost</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Food cost %</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.weekStart} className="border-b border-border/60">
                <td className="py-1.5">{p.weekLabel}</td>
                <td className="tabular py-1.5 text-right">{formatINR(p.revenue, "whole")}</td>
                <td className="tabular py-1.5 text-right">{formatINR(p.directCost, "whole")}</td>
                <td className="tabular py-1.5 text-right">{p.foodCostBps === null ? "—" : formatBps(p.foodCostBps, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

import { type Paise, formatINR, toRupeesFloat } from "@/lib/money";

export interface DayPoint {
  date: string;
  revenue: Paise;
  orders: number;
}

/**
 * Revenue by day.
 *
 * A bar chart: magnitude across discrete days, one series. Inline SVG rather
 * than a charting library — one series of at most thirty bars does not need a
 * runtime, and this way every colour comes from a token.
 *
 * One hue, because there is one series. The validated brand red passes the
 * lightness band, the chroma floor and contrast against the panel.
 *
 * Labels are selective: the highest day and the ends. A number on every bar is
 * a table pretending to be a chart.
 */
export function RevenueChart({ series, className }: { series: readonly DayPoint[]; className?: string }) {
  if (series.length === 0) return null;

  const values = series.map((point) => toRupeesFloat(point.revenue));
  const peak = Math.max(...values, 1);
  const peakIndex = values.indexOf(Math.max(...values));

  const width = 100;
  const height = 34;
  // A 2px surface gap between adjacent bars, per the mark spec.
  const slot = width / series.length;
  const barWidth = Math.max(slot * 0.62, 0.8);

  const labelled = new Set([0, series.length - 1, peakIndex]);
  const short = (date: string) =>
    new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Revenue by day. Highest was ${formatINR(series[peakIndex]!.revenue)} on ${short(series[peakIndex]!.date)}.`}
      >
        {/* A single recessive baseline. No gridlines: thirty bars with a
            reference line would out-ink the data. */}
        <line x1="0" y1={height} x2={width} y2={height} stroke="var(--border)" strokeWidth="0.3" />

        {series.map((point, index) => {
          const value = toRupeesFloat(point.revenue);
          const barHeight = value === 0 ? 0 : Math.max((value / peak) * (height - 2), 0.6);
          const x = index * slot + (slot - barWidth) / 2;
          return (
            <rect
              key={point.date}
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx="0.6"
              fill="var(--primary)"
              opacity={value === 0 ? 0.18 : 1}
            >
              <title>
                {short(point.date)} — {formatINR(point.revenue)}, {point.orders}{" "}
                {point.orders === 1 ? "order" : "orders"}
              </title>
            </rect>
          );
        })}
      </svg>

      <figcaption className="mt-2 flex justify-between text-xs text-muted-foreground">
        {series.map((point, index) =>
          labelled.has(index) ? (
            <span key={point.date} className="tabular">
              {short(point.date)}
            </span>
          ) : null,
        )}
      </figcaption>

      {/* Identity is never colour alone, and a chart is never the only way to
          read the numbers. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">See the figures</summary>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-1.5 font-semibold">Day</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Orders</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.date} className="border-b border-border/60">
                <td className="py-1.5">{short(point.date)}</td>
                <td className="tabular py-1.5 text-right">{point.orders}</td>
                <td className="tabular py-1.5 text-right">{formatINR(point.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

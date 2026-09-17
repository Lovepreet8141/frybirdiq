/**
 * Owner-facing names for IQ metrics (review I4) and the week naming (I5).
 *
 * One label per metric, so the Overview, the P&L, the brief and the AI all
 * call a figure the same thing. Plain strings; no currency formatting here.
 */

import type { AnyMetricId } from "./catalog";
import { businessWeek } from "./business-day";

export const METRIC_LABELS: Readonly<Record<AnyMetricId, string>> = {
  orders_paid: "Paid orders",
  revenue_net: "Net sales (excl. GST)",
  revenue_net_by_product: "Net sales by product (excl. GST)",
  units_sold: "Units sold",
  gst_output: "GST collected",
  sales_gross: "Gross sales (incl. GST)",
  points_tender: "Paid with loyalty points",
  discount_total: "Discounts",
  orders_comp: "Complimentary orders",
  orders_cancelled: "Cancelled orders",
  orders_failed: "Failed orders",
  orders_refunded: "Refunded orders",
  orders_part_refunded: "Partly refunded orders",
  refunds_amount: "Refunds paid out",
  captured_amount: "Collected (cash received)",
  expense_direct: "Direct costs (recorded purchases)",
  expense_operating: "Operating expenses",
  expense_nonoperating: "Non-operating expenses",
  food_cost_theoretical: "Food cost – recipe (amount)",
  food_cost_actual: "Food used incl. waste and shrinkage",
  waste_cost: "Waste",
  sale_lines_costed: "Costed sale lines",
  sale_lines_total: "Sale lines",
  aov_net: "Average order (excl. GST)",
  food_cost_pct_theoretical: "Food cost – recipe",
  food_cost_pct_recorded_purchases: "Food cost – recorded purchases",
  gross_profit: "Gross profit",
  net_profit: "Net profit",
  channel_share: "Share of net sales",
  gross_margin_bps: "Gross margin",
  net_margin_bps: "Net margin",
  net_collected: "Net collected (after refunds)",
};

export function metricLabel(id: AnyMetricId): string {
  return METRIC_LABELS[id];
}

/** A week is Monday to Sunday in IST. A rolling window is always called "Last 7 days". */
export const WEEK_DEFINITION = "Mon–Sun (IST)";
export const LAST_7_DAYS_LABEL = "Last 7 days";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function shortDate(date: string): { day: number; month: string; year: number } {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { day, month: MONTHS[month - 1]!, year };
}

/**
 * "Week of Mon 14 Sep – Sun 20 Sep 2026" for the week containing `date`.
 * The year is shown on the start too when the week crosses a year end.
 */
export function weekLabel(date: string): string {
  const { start, end } = businessWeek(date);
  const s = shortDate(start);
  const e = shortDate(end);
  const startYear = s.year === e.year ? "" : ` ${s.year}`;
  return `Week of Mon ${s.day} ${s.month}${startYear} – Sun ${e.day} ${e.month} ${e.year}`;
}

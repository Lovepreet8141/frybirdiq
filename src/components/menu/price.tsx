import { type Paise, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A rupee amount.
 *
 * Always tabular, so a column of prices lines up and a changing total does not
 * jitter horizontally. Always through `formatINR`, which is the only thing in
 * the codebase that produces a ₹.
 */
export function Price({
  amount,
  precision = "auto",
  className,
}: {
  amount: Paise;
  precision?: "auto" | "unit" | "whole";
  className?: string;
}) {
  return <span className={cn("tabular", className)}>{formatINR(amount, precision)}</span>;
}

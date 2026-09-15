/**
 * Money — the single source of truth for currency in Frybird IQ.
 *
 * BUILD-PLAN.md §26, §51.
 *
 * Every amount in this system is an integer count of **paise**, held in a
 * `bigint`. There is no float anywhere in the money path, no `numeric` in app
 * code, and no other module formats currency. Rupees exist only as display
 * output and as user input at the edges.
 *
 * The currency is INR and only INR. FRYBIRD trades in Ambala; there is no
 * multi-currency requirement and inventing one would mean carrying a currency
 * code through every row for no benefit.
 */

declare const PAISE: unique symbol;

/** An integer number of paise. 100 paise = ₹1. */
export type Paise = bigint & { readonly [PAISE]: true };

/** Basis points. 10_000 bps = 100%. GST at 5% is 500 bps. */
export type Bps = number;

export const ZERO = 0n as Paise;

/** Rounds `a / b` half away from zero. All money division goes through here. */
function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("money: division by zero");
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const quotient = absA / absB;
  const remainder = absA % absB;
  const rounded = remainder * 2n >= absB ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Wraps a raw integer count of paise. Rejects anything non-integer. */
export function paise(value: bigint | number): Paise {
  if (typeof value === "bigint") return value as Paise;
  if (!Number.isInteger(value)) {
    throw new RangeError(`money: ${value} is not a whole number of paise`);
  }
  return BigInt(value) as Paise;
}

/**
 * Parses a rupee amount as written by a human or stored in a document —
 * "2800", "2,800.50", "₹1,04,999.99", 2800.5.
 *
 * Strings are parsed digit by digit and never touch a float. Numbers are
 * rounded to the nearest paise, because `33.33 * 100` is not `3333` in IEEE
 * 754. Prefer passing strings for anything read from a form or an invoice.
 */
export function fromRupees(value: string | number): Paise {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`money: ${value} is not a finite amount`);
    }
    return paise(Math.round(value * 100));
  }

  const cleaned = value.replace(/[₹,\s]/g, "").trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (match[2] === "" && match[3] === undefined)) {
    throw new RangeError(`money: cannot read "${value}" as rupees`);
  }

  const [, sign, whole = "", fraction = ""] = match;
  if (fraction.length > 2) {
    throw new RangeError(`money: "${value}" is finer than one paise`);
  }

  const total = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  return paise(sign ? -total : total);
}

/**
 * Lossy. Returns a float for charting libraries and nothing else.
 * Never feed the result back into a calculation.
 */
export function toRupeesFloat(amount: Paise): number {
  return Number(amount) / 100;
}

export function add(...amounts: readonly Paise[]): Paise {
  return amounts.reduce<bigint>((total, amount) => total + amount, 0n) as Paise;
}

export function subtract(a: Paise, b: Paise): Paise {
  return (a - b) as Paise;
}

export function negate(amount: Paise): Paise {
  return -amount as Paise;
}

export function abs(amount: Paise): Paise {
  return (amount < 0n ? -amount : amount) as Paise;
}

/** Multiplies by a whole quantity — 3 burgers, 12 boxes. */
export function multiply(amount: Paise, quantity: bigint | number): Paise {
  if (typeof quantity === "number" && !Number.isInteger(quantity)) {
    throw new RangeError(
      `money: multiply takes a whole quantity, got ${quantity} — use scale() for fractional amounts`,
    );
  }
  return (amount * BigInt(quantity)) as Paise;
}

/**
 * Scales by a fraction expressed as a numerator and denominator, so a recipe
 * using 150g out of a 1kg pack stays exact: `scale(packCost, 150, 1000)`.
 */
export function scale(amount: Paise, numerator: bigint | number, denominator: bigint | number): Paise {
  return divRound(amount * BigInt(numerator), BigInt(denominator)) as Paise;
}

/** Applies a rate in basis points. `percentOf(price, 2500)` is 25%. */
export function percentOf(amount: Paise, rate: Bps): Paise {
  if (!Number.isInteger(rate)) {
    throw new RangeError(`money: ${rate} is not a whole number of basis points`);
  }
  return divRound(amount * BigInt(rate), 10_000n) as Paise;
}

/** Converts a human percentage to basis points. `bps(2.5)` is 250. */
export function bps(percent: number): Bps {
  const value = Math.round(percent * 100);
  if (Math.abs(value - percent * 100) > 1e-6) {
    throw new RangeError(`money: ${percent}% is finer than one basis point`);
  }
  return value;
}

/**
 * Expresses `part / whole` in basis points — food cost %, margin %, channel
 * share of revenue. Returns 0 when the whole is zero rather than throwing,
 * because a day with no sales is a real state the dashboard has to render.
 */
export function ratioBps(part: Paise, whole: Paise): Bps {
  if (whole === 0n) return 0;
  return Number(divRound(part * 10_000n, whole));
}

/**
 * Splits an amount across weights so the parts sum to exactly the total.
 *
 * Used for discounts spread over order lines and for GST apportionment. Naive
 * per-line rounding loses or invents paise; largest-remainder does not. The
 * leftover paise go to the largest remainders, ties breaking towards the
 * earlier line.
 */
export function allocate<const W extends readonly (bigint | number)[]>(
  amount: Paise,
  weights: W,
): { -readonly [K in keyof W]: Paise } {
  if (weights.length === 0) throw new RangeError("money: allocate needs at least one weight");

  const parts = weights.map((weight) => BigInt(weight));
  if (parts.some((weight) => weight < 0n)) {
    throw new RangeError("money: allocate weights cannot be negative");
  }

  const totalWeight = parts.reduce((total, weight) => total + weight, 0n);
  if (totalWeight === 0n) {
    throw new RangeError("money: allocate weights cannot all be zero");
  }

  const negative = amount < 0n;
  const target = negative ? -amount : amount;

  const floors = parts.map((weight) => (target * weight) / totalWeight);
  const remainders = parts
    .map((weight, index) => ({ index, remainder: (target * weight) % totalWeight }))
    .sort((a, b) => (b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1));

  // Hand the leftover paise to the largest remainders, one each, so the parts
  // sum to exactly the total.
  let distributed = floors.reduce((total, share) => total + share, 0n);
  const getsExtra = new Set<number>();
  for (const { index } of remainders) {
    if (distributed >= target) break;
    getsExtra.add(index);
    distributed += 1n;
  }

  return floors.map((share, index) => {
    const value = getsExtra.has(index) ? share + 1n : share;
    return (negative ? -value : value) as Paise;
  }) as { -readonly [K in keyof W]: Paise };
}

export function compare(a: Paise, b: Paise): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isZero(amount: Paise): boolean {
  return amount === 0n;
}

export function isNegative(amount: Paise): boolean {
  return amount < 0n;
}

/**
 * How many decimal places to show.
 *
 * - `auto` (default) — whole rupees, unless the amount carries paise. Correct
 *   for anything at business scale.
 * - `unit` — always two places. Correct for a unit cost: ₹33.50 per portion.
 * - `whole` — always whole rupees, truncating a fractional tail from display
 *   only. Correct for KPI tiles and charts.
 */
export type Precision = "auto" | "unit" | "whole";

/** Renders a decimal string like "-104999.99" without going through a float. */
function toDecimalString(amount: Paise, fractionDigits: 0 | 2): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const rupees = fractionDigits === 0 ? divRound(value, 100n) : value / 100n;
  const sign = negative ? "-" : "";
  if (fractionDigits === 0) return `${sign}${rupees}`;
  return `${sign}${rupees}.${(value % 100n).toString().padStart(2, "0")}`;
}

function digitsFor(amount: Paise, precision: Precision): 0 | 2 {
  if (precision === "unit") return 2;
  if (precision === "whole") return 0;
  return amount % 100n === 0n ? 0 : 2;
}

/**
 * The only currency formatter in the codebase.
 *
 * Uses `en-IN` so grouping is Indian — ₹9,40,000, never ₹940,000. Anything
 * that renders money calls this; nothing re-implements it.
 */
export function formatINR(amount: Paise, precision: Precision = "auto"): string {
  const digits = digitsFor(amount, precision);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toDecimalString(amount, digits) as unknown as number);
}

/**
 * Rupees as a plain decimal string — "940000.00", never grouped, never a ₹
 * sign. For a CSV export or anything else a spreadsheet has to sum: Indian
 * grouping (`formatAmount`'s "9,40,000") is a comma inside the cell, which
 * breaks it as a number rather than displaying it as one. This is the only
 * other place money leaves paise as text, and it goes through the same
 * rounding as every formatter above.
 */
export function toPlainDecimal(amount: Paise, precision: Precision = "unit"): string {
  return toDecimalString(amount, digitsFor(amount, precision));
}

/** The number without the ₹, for tables that carry the unit in the header. */
export function formatAmount(amount: Paise, precision: Precision = "auto"): string {
  const digits = digitsFor(amount, precision);
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toDecimalString(amount, digits) as unknown as number);
}

/** Renders basis points as a percentage — `formatBps(2750)` is "27.5%". */
export function formatBps(rate: Bps, fractionDigits = 1): string {
  return `${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(rate / 100)}%`;
}

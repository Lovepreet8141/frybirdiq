/**
 * The daily brief's words — every sentence the owner reads, as a template.
 *
 * IQ-2 DESIGN.md R2.10 (BUSINESS-INTELLIGENCE). The rule this file keeps:
 * **no template carries a number of its own.** Every figure, date or count
 * in a brief line arrives through a `{slot}` filled by `compose.ts` from a
 * cited insight's `present()` output, the brief's own date, or a count of the
 * lines it left out. `templates.test.ts` fails on a digit in any constant
 * here, and the grounding test fails on a digit that no slot accounts for.
 *
 * No rule ids, no trust signal codes (t1…t7), no grade names reach the
 * owner: each maps to a plain phrase below.
 */

export type TemplatePiece = { readonly kind: "text"; readonly text: string } | { readonly kind: "slot"; readonly name: string };

/** Splits "Net sales: {value}" into text and slot pieces. Braces never appear in rendered text. */
export function parseTemplate(pattern: string): readonly TemplatePiece[] {
  const pieces: TemplatePiece[] = [];
  const re = /\{([a-zA-Z]+)\}/g;
  let last = 0;
  for (let match = re.exec(pattern); match; match = re.exec(pattern)) {
    if (match.index > last) pieces.push({ kind: "text", text: pattern.slice(last, match.index) });
    pieces.push({ kind: "slot", name: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < pattern.length) pieces.push({ kind: "text", text: pattern.slice(last) });
  return pieces;
}

/* ------------------------------------------------------------------ */
/* Headings                                                             */
/* ------------------------------------------------------------------ */

export const SECTION_COPY = {
  yesterday: { heading: "Yesterday", subline: "{date}" },
  risks: { heading: "Risks", subline: "Problems the checks found" },
  worthKnowing: { heading: "Worth knowing", subline: "Unusual, but not a problem on its own" },
  treatWithCare: { heading: "Treat with care", subline: "Figures or checks we could not fully confirm" },
  footer: { heading: "Not checked in this version" },
  asOf: "As of {time}, {date}",
  more: "and {count} more",
  notReady: "The brief for {date} is not ready yet: the day's figures have not been finalised.",
  restricted: "Payment checks are shown to finance roles only.",
} as const;

export const EMPTY_RISKS = {
  /** Every check the viewer may see ran for the day and none found a problem. */
  NO_RISKS: "No risks found.",
  /** Same, for a viewer without finance.view: the all-clear covers sales checks only. */
  NO_RISKS_SALES_ONLY: "No risks found in the sales checks.",
  /** At least one check did not run: an empty list is not an all-clear. */
  CHECKS_INCOMPLETE: "Some checks did not run, so this is not an all-clear. See Treat with care.",
} as const;

/* ------------------------------------------------------------------ */
/* Yesterday — FACT lines, in the order R2.10 fixes                      */
/* ------------------------------------------------------------------ */

export const BRIEF_DAY_METRICS = ["revenue_net", "orders_paid", "aov_net", "food_cost_pct_theoretical", "net_collected"] as const;
export type BriefDayMetric = (typeof BRIEF_DAY_METRICS)[number];

export const FACT_TEMPLATES: Readonly<Record<BriefDayMetric, string>> = {
  revenue_net: "Net sales (excl. GST): {value}",
  orders_paid: "Orders: {value}",
  aov_net: "Average order (excl. GST): {value}",
  food_cost_pct_theoretical: "Food cost, recipe estimate: {value} of net sales",
  // R2.10 / C3: captured minus refunds, all methods, GST included.
  net_collected: "Collected after refunds (incl. GST): {value}",
};

export const MONTH_TO_DATE_TEMPLATE =
  "Month to date net sales: {current} ({currentFrom} to {currentTo}). Same days last month: {previous} ({previousFrom} to {previousTo}).";
export const MONTH_TO_DATE_CLAMPED = " Last month is shorter, so it covers fewer days.";

/** Appended to a FACT line whose trust is below HIGH. */
export const TRUST_NOTE = {
  MEDIUM: " (medium confidence: {reason})",
  LOW: " (low confidence: {reason})",
  UNKNOWN: " (confidence not measured: {reason})",
} as const;

/* ------------------------------------------------------------------ */
/* Detections                                                           */
/* ------------------------------------------------------------------ */

/**
 * Keyed by the insight's `copy.templateId`. Slots: observed, baseline,
 * deviation (always unsigned; the sentence carries the direction), weekday,
 * direction ("above"/"below"), start/end (times from the insight's period).
 */
export const DETECTION_TEMPLATES: Readonly<Record<string, string>> = {
  "detect.sales.below_weekday_baseline": "Net sales were {observed}, {deviation} below a normal {weekday} ({baseline}).",
  "detect.sales.above_weekday_baseline": "Net sales were {observed}, {deviation} above a normal {weekday} ({baseline}).",
  "detect.orders.below_weekday_baseline": "Orders were {observed}, {deviation} below a normal {weekday} ({baseline}).",
  "detect.aov.shift": "The average order was {observed}, {deviation} {direction} a normal {weekday} ({baseline}).",
  "detect.discount.spike": "Discounts came to {observed} of sales, against a usual {baseline} on a {weekday}.",
  "detect.cancellations.spike": "Cancelled or failed orders: {observed}, against a usual {baseline} on a {weekday}.",
  "detect.refunds.spike": "Refunds came to {observed}, above the day's limit of {baseline}.",
  "detect.waste.spike": "Waste came to {observed}, against a usual {baseline} on a {weekday}.",
  "detect.food_cost.above_baseline": "Food cost (recipe estimate) was {observed} of net sales, against a usual {baseline}.",
  "detect.food_cost.above_target": "Food cost (recipe estimate) was {observed} of net sales, above your target of {baseline}.",
  "detect.channel_mix.shift": "Online orders were {observed} of net sales, {direction} a usual {baseline}.",
  // IQ-2 S9 (IQ-ENGINE) writes pulse.no_orders with this templateId; the times come from the insight's period.
  "pulse.no_orders": "No orders came in between {start} and {end}.",

  /*
   * Reconciliation (FINANCE-LEDGER a4a0774, R2.6). `templateId` is the rule
   * id, so one entry per rule in RECON_RULE_IDS; `{observed}` is the count of
   * unexplained breaks that rule found on the day. Every one of these is
   * finance.view only — `presentFor` drops them for anyone else before the
   * brief sees them, so nothing here needs to hedge.
   *
   * Counted things are phrased as a noun then the count, never "{observed}
   * orders", so the sentence reads correctly when the count is one.
   */
  "recon.facts_parity": "The day's stored figures did not match a recount from the ledger. Figures that disagree: {observed}.",
  "recon.order_totals": "Orders whose totals do not add up to their own lines: {observed}.",
  "recon.capture_vs_total": "Orders paid more than once, or paid an amount different from the bill: {observed}.",
  "recon.status_vs_payment": "Orders that closed with no payment recorded against them: {observed}.",
  "recon.refund_vs_payment": "Refunds that do not match the payment they came from: {observed}.",
  "recon.invoice": "Invoice numbers missing, malformed, duplicated or out of sequence: {observed}.",
  "recon.gst_lines": "Bills whose GST lines do not add up: {observed}.",
  "recon.loyalty_refund": "Refunded orders still holding loyalty points or a stamp: {observed}.",

  /*
   * The two rules that also carry money (`withAmount` in rules.ts). The job
   * writes the amount as its own insight, so it is its own line: a count with
   * no amount hides how much is at stake, and a group sentence would drop one
   * figure or the other.
   */
  "recon.capture_vs_total.paise": "Money involved in those payment mismatches: {observed}.",
  "recon.refund_vs_payment.paise": "Money involved in those refund mismatches: {observed}.",

  /*
   * An explained finding, keyed by the card that explains it
   * (`recon.explained.<card>`; EXPLAINING_CARDS in reconcile/explanations.ts
   * has only pay-4 today). It is still shown, with its count: a customer paid
   * twice whatever the cause. `explainingCardOf` adds the "known issue" suffix.
   */
  "recon.explained.pay-4": "Orders paid more than once before the guard against a second charge went live: {observed}.",

  /*
   * Money crash signatures (PAYMENT-SAFETY 1f2afc0, R2.7). `templateId` is the
   * rule id; `{observed}` is the row count, and the insight carries no order
   * id, amount or claim key by design. A signature is a standing condition
   * rather than a thing that happened on the day, so none of these name a date.
   */
  "sig.double_capture": "Orders charged twice: {observed}.",
  "sig.refund_unrecorded": "Payments marked refunded with no matching refund recorded: {observed}.",
  "sig.refund_followup_lost": "Refunded orders whose follow-up never finished, so the order and its loyalty points are still as they were: {observed}.",
  "sig.half_order": "Unpaid orders left half written, with no items or no payment: {observed}.",
  "sig.capture_on_terminal": "Orders that took money after they were cancelled, failed or refunded: {observed}.",
  "sig.claim_stuck": "Orders or payments that started and never finished: {observed}.",
  "sig.webhook_failed": "Payment updates from the gateway that never processed: {observed}.",
};

/** Prefix of an explained reconciliation finding's templateId; what follows is the card id. */
export const EXPLAINED_TEMPLATE_PREFIX = "recon.explained.";

/**
 * The fix card an insight names itself, or null. The reconcile job puts the
 * card in the templateId of its `.explained` insight rather than in a column,
 * so the brief reads it from there and needs no port of its own; `BriefInput`
 * may still pass `explainedBy` to explain a finding this does not cover.
 */
export function explainingCardOf(templateId: string): string | null {
  if (!templateId.startsWith(EXPLAINED_TEMPLATE_PREFIX)) return null;
  const card = templateId.slice(EXPLAINED_TEMPLATE_PREFIX.length);
  return card.length > 0 ? card : null;
}

/** Several rules that describe one problem become one line (R2.10 "one line per problem"). */
export const RULE_GROUPS: Readonly<Record<string, string>> = {
  "sig.double_capture": "payment_totals",
  "recon.capture_vs_total": "payment_totals",
};

export const GROUP_TEMPLATES: Readonly<Record<string, string>> = {
  payment_totals: "Some orders were paid more than once, or paid a different amount from their bill.",
};

/** A finding with no template of its own still reaches the owner — without figures, never as a rule id. */
export const GENERIC_TEMPLATES = {
  recon: "A payment records check found a problem that needs a look.",
  sig: "A payment safety check found a problem that needs a look.",
  detect: "A sales check flagged something unusual in {metric}.",
  pulse: "A service check flagged something during the day.",
  other: "A check flagged something that needs a look.",
} as const;

export const STATUS_SUFFIX = {
  RESOLVED: " It has since cleared.",
  RECOVERED: " It recovered later in the day.",
  CAPPED: " We could not fully confirm the data behind this: {reason}.",
  KNOWN_ISSUE: " Known issue, fix in {card}.",
} as const;

/* ------------------------------------------------------------------ */
/* Treat with care                                                      */
/* ------------------------------------------------------------------ */

export type CheckName = "detect" | "reconcile" | "signatures";

export const CHECK_WORDS: Readonly<Record<CheckName, string>> = {
  detect: "Sales checks",
  reconcile: "Payment records checks",
  signatures: "Payment safety checks",
};

export const CHECK_NOT_RUN = "{check} did not run for {date}.";
export const CHECK_FAILED = "{check} failed for {date}.";
export const PARITY_NOT_CHECKED = "Daily figures were not checked against the P&L for {date}.";
export const PARITY_MISMATCH = "Daily figures did not match the P&L check for {date}, so treat totals with care.";
export const TRUST_DROPPED = "The data behind {metrics} became less reliable: {reason}.";
export const NOT_EVALUATED = "Could not compare {metrics} with a normal day: {reason}.";

/** Plain words for each detector figure (`subject.ref` of a detector insight). */
export const FIGURE_WORDS: Readonly<Record<string, string>> = {
  revenue_net: "net sales",
  orders_paid: "orders",
  aov_net: "the average order",
  discount_share: "discounts",
  orders_cancelled_failed: "cancellations",
  refunds_amount: "refunds",
  refunds_count: "refunds",
  sales_gross: "gross sales",
  waste_cost: "waste",
  food_cost_pct_theoretical: "food cost",
  online_share: "the online share",
};

/** The detector rules whose skipped runs the brief reports, and the words for what they compare. */
export const RULE_WORDS: Readonly<Record<string, string>> = {
  "sales.below_weekday_baseline": "net sales",
  "sales.above_weekday_baseline": "net sales",
  "orders.below_weekday_baseline": "orders",
  "aov.shift": "the average order",
  "discount.spike": "discounts",
  "cancellations.spike": "cancellations",
  "refunds.spike": "refunds",
  "waste.spike": "waste",
  "food_cost.above_baseline": "food cost",
  "channel_mix.shift": "the online share",
};

/**
 * Why a detector did not evaluate, in words. Reasons missing here are left
 * out of the brief on purpose: `closed_day` and `excluded_date` are not gaps,
 * `no_target` waits on an owner decision (dec-7) and `previous_trust_unknown`
 * only affects the trust-drop rule.
 */
export const NOT_EVALUATED_REASONS: Readonly<Record<string, string>> = {
  insufficient_history: "there are not enough past weeks to compare with yet",
  zero_median: "there is no usual level to compare with yet",
  low_trust: "the data was not reliable enough",
  no_trust: "the data has not been scored for reliability",
  figure_missing: "the figure was missing",
  no_facts: "the day's figures were missing",
  parity_flagged: "daily figures did not match the P&L",
};

/** Trust reason codes (`trustRefFor` upper-cases the signal id) to plain words. */
export const SIGNAL_REASONS: Readonly<Record<string, string>> = {
  T1_RECIPE_COVERAGE: "some items sold have no costed recipe",
  T1B_COSTED_SALE_ROWS: "some sales were recorded without a cost",
  T2_PRICE_FRESHNESS: "some ingredient prices are out of date",
  T3_STOCK_COUNT_RECENCY: "stock has not been counted recently",
  T4_WASTE_LOGGING: "waste was not logged every day",
  T5_CLOCK_SANITY: "some order times look wrong",
  T6_PAYMENT_INTEGRITY: "some payment records do not add up",
  T7_COST_RECORDING: "direct costs have not been recorded recently",
};
export const UNSCORED_REASON = "its reliability has not been scored yet";

/** R2.10: items IQ-2 cannot see at all. Shown once as a fixed footer, never as daily gaps. */
export const NOT_CHECKED_FOOTER: readonly string[] = [
  "Refunds made from the payment gateway's dashboard.",
  "Online payments taken by the gateway but not recorded here.",
  "Online payments matched to the wrong order.",
  "Cash in the till against cash recorded, as there is no till count yet.",
];

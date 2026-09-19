import { describe, expect, it } from "vitest";

import { BASELINE_RULES } from "@/lib/iq/detect/rules";

import * as T from "./templates";

function strings(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  return [];
}

const KNOWN_SLOTS = new Set(["value", "current", "currentFrom", "currentTo", "previous", "previousFrom", "previousTo", "reason", "observed", "baseline", "deviation", "weekday", "direction", "start", "end", "metric", "card", "check", "date", "metrics", "time", "count"]);

describe("brief templates", () => {
  const all = Object.entries(T)
    .filter(([, v]) => typeof v !== "function")
    .flatMap(([name, v]) => strings(v, name));

  it("carry no number of their own", () => {
    expect(all.length).toBeGreaterThan(50);
    for (const { path, text } of all) expect(text, path).not.toMatch(/\d/);
  });

  it("name no rule id, signal code or grade in words the owner reads", () => {
    // RULE_GROUPS, BRIEF_DAY_METRICS and EXPLAINED_TEMPLATE_PREFIX are identifiers the code matches on, never words anyone reads.
    const sentences = all.filter(({ path }) => !/^(RULE_GROUPS|BRIEF_DAY_METRICS|EXPLAINED_TEMPLATE_PREFIX)/.test(path));
    for (const { path, text } of sentences) {
      expect(text, path).not.toMatch(/\b(GRADE_|recon\.|sig\.|detect\.|T\d|t\d_)|\b(HIGH|MEDIUM|LOW|UNKNOWN)\b/);
    }
  });

  it("use only slots compose.ts fills", () => {
    for (const { path, text } of all) {
      for (const piece of T.parseTemplate(text)) if (piece.kind === "slot") expect(KNOWN_SLOTS.has(piece.name), `${path}: {${piece.name}}`).toBe(true);
    }
  });

  it("parse text and slots in order", () => {
    expect(T.parseTemplate("Orders: {value} today")).toEqual([
      { kind: "text", text: "Orders: " },
      { kind: "slot", name: "value" },
      { kind: "text", text: " today" },
    ]);
    expect(T.parseTemplate("{a}{b}")).toEqual([{ kind: "slot", name: "a" }, { kind: "slot", name: "b" }]);
  });

  it("cover every baseline detector rule, and explain every skipped-comparison rule in words", () => {
    for (const rule of BASELINE_RULES) {
      expect(T.DETECTION_TEMPLATES[`detect.${rule.ruleId}`], rule.ruleId).toBeDefined();
      expect(T.RULE_WORDS[rule.ruleId], rule.ruleId).toBeDefined();
    }
    expect(T.DETECTION_TEMPLATES["detect.refunds.spike"]).toBeDefined();
    expect(T.DETECTION_TEMPLATES["detect.food_cost.above_target"]).toBeDefined();
  });

  /*
   * RECON_RULE_IDS (reconcile/rules.ts) and PRE_REFUND_SIGNATURES
   * (signatures/pre-refund.ts) are not on this branch yet, so the lists are
   * copied here from FINANCE-LEDGER a4a0774 and PAYMENT-SAFETY 1f2afc0.
   * Import them instead once those branches merge.
   */
  const RECON_RULE_IDS = [
    "recon.facts_parity",
    "recon.order_totals",
    "recon.capture_vs_total",
    "recon.status_vs_payment",
    "recon.refund_vs_payment",
    "recon.invoice",
    "recon.gst_lines",
    "recon.loyalty_refund",
  ];
  /** The two rules `evaluateReconWindow` calls with `withAmount`, which also write a `.paise` insight. */
  const RECON_AMOUNT_RULE_IDS = ["recon.capture_vs_total", "recon.refund_vs_payment"];
  const SIGNATURE_RULE_IDS = [
    "sig.double_capture",
    "sig.refund_unrecorded",
    "sig.refund_followup_lost",
    "sig.half_order",
    "sig.capture_on_terminal",
    "sig.claim_stuck",
    "sig.webhook_failed",
  ];

  it("cover every reconciliation rule, its amount, and every money signature", () => {
    for (const ruleId of RECON_RULE_IDS) expect(T.DETECTION_TEMPLATES[ruleId], ruleId).toBeDefined();
    for (const ruleId of RECON_AMOUNT_RULE_IDS) expect(T.DETECTION_TEMPLATES[`${ruleId}.paise`], ruleId).toBeDefined();
    for (const ruleId of SIGNATURE_RULE_IDS) expect(T.DETECTION_TEMPLATES[ruleId], ruleId).toBeDefined();
    // EXPLAINING_CARDS (reconcile/explanations.ts) has one entry today.
    expect(T.DETECTION_TEMPLATES["recon.explained.pay-4"]).toBeDefined();
  });

  it("show a count with the thing counted named first, so one reads correctly", () => {
    for (const ruleId of [...RECON_RULE_IDS, ...SIGNATURE_RULE_IDS]) {
      const pattern = T.DETECTION_TEMPLATES[ruleId]!;
      expect(pattern, ruleId).toContain("{observed}");
      expect(pattern, ruleId).not.toMatch(/\{observed\}\s+[a-z]/);
    }
  });

  it("read the explaining card off an explained finding's templateId", () => {
    expect(T.explainingCardOf("recon.explained.pay-4")).toBe("pay-4");
    expect(T.explainingCardOf("recon.capture_vs_total")).toBeNull();
    expect(T.explainingCardOf("recon.explained.")).toBeNull();
    expect(T.explainingCardOf("detect.sales.below_weekday_baseline")).toBeNull();
  });

  it("put Collected on the GST-inclusive, after-refunds basis (C3)", () => {
    expect(T.FACT_TEMPLATES.net_collected).toBe("Collected after refunds (incl. GST): {value}");
    expect(T.FACT_TEMPLATES.revenue_net).toContain("excl. GST");
  });
});

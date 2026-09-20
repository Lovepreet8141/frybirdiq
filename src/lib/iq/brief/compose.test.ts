import { describe, expect, it } from "vitest";

import type { TrustRef } from "@/lib/iq/engine";

import {
  ALL_RAN,
  ANALYST,
  DATE,
  briefFacts,
  detection,
  detections,
  input,
  morningAfter,
  stored,
  trust,
} from "./__test-support__/brief";
import { RISK_CAP, TREAT_WITH_CARE_CAP, composeBrief, parityFromSummary, renderBriefText, type BriefLine } from "./compose";
import { EMPTY_RISKS } from "./templates";

const texts = (lines: readonly BriefLine[]) => lines.map((l) => l.text);

describe("composeBrief: Yesterday (R2.10 B1)", () => {
  it("is NOT_READY with no figures when the brief job wrote nothing for the day", async () => {
    const { insights } = await detections(DATE, { values: { revenue_net: 500000n } });
    const brief = composeBrief(input(DATE, insights));
    expect(brief.state).toBe("NOT_READY");
    expect(brief.notReady?.text).toBe("The brief for Fri 11 Sep is not ready yet: the day's figures have not been finalised.");
    expect(brief.risks.lines).toEqual([]);
    expect(brief.insightIds).toEqual([]);
  });

  it("lists the five day figures in order, then month to date beside the same days last month", async () => {
    const brief = composeBrief(input(DATE, await briefFacts(DATE)));
    expect(brief.state).toBe("READY");
    expect(brief.yesterday.heading.text).toBe("Fri 11 Sep");
    expect(brief.yesterday.lines.map((l) => l.key)).toEqual([
      "fact:revenue_net",
      "fact:orders_paid",
      "fact:aov_net",
      "fact:food_cost_pct_theoretical",
      "fact:net_collected",
      "fact:revenue_net:month_to_date",
    ]);
    expect(texts(brief.yesterday.lines)).toEqual([
      "Net sales (excl. GST): ₹10,000",
      "Orders: 40",
      "Average order (excl. GST): ₹250",
      "Food cost, recipe estimate: 31.5% of net sales",
      "Collected after refunds (incl. GST): ₹11,800",
      "Month to date net sales: ₹1,10,000 (1 Sep to 11 Sep). Same days last month: ₹1,04,000 (1 Aug to 11 Aug).",
    ]);
  });

  it("says when last month is shorter", async () => {
    const brief = composeBrief(input("2026-03-31", await briefFacts("2026-03-31")));
    expect(brief.yesterday.lines.at(-1)?.text).toBe(
      "Month to date net sales: ₹1,10,000 (1 Mar to 31 Mar). Same days last month: ₹1,04,000 (1 Feb to 28 Feb). Last month is shorter, so it covers fewer days.",
    );
  });

  it("shows trust only below HIGH, in plain words, never a grade or signal code", async () => {
    const facts = await briefFacts(DATE, {
      trust: { food_cost_pct_theoretical: trust("LOW", "t1_recipe_coverage"), net_collected: trust("MEDIUM", "t6_payment_integrity"), orders_paid: trust("UNKNOWN") },
    });
    const brief = composeBrief(input(DATE, facts));
    const byKey = new Map(brief.yesterday.lines.map((l) => [l.key, l.text]));
    expect(byKey.get("fact:revenue_net")).toBe("Net sales (excl. GST): ₹10,000");
    expect(byKey.get("fact:food_cost_pct_theoretical")).toBe("Food cost, recipe estimate: 31.5% of net sales (low confidence: some items sold have no costed recipe)");
    expect(byKey.get("fact:net_collected")).toBe("Collected after refunds (incl. GST): ₹11,800 (medium confidence: some payment records do not add up)");
    expect(byKey.get("fact:orders_paid")).toBe("Orders: 40 (confidence not measured: its reliability has not been scored yet)");
    expect(renderBriefText(brief)).not.toMatch(/GRADE_|T[0-9]_|t[0-9]_|LOW|MEDIUM|HIGH/);
  });

  it("drops a line whose FACT is missing and counts it", async () => {
    const brief = composeBrief(input(DATE, await briefFacts(DATE, { aov_net: null, sameDaysLastMonth: null })));
    expect(brief.yesterday.lines.map((l) => l.key)).toEqual(["fact:revenue_net", "fact:orders_paid", "fact:food_cost_pct_theoretical", "fact:net_collected"]);
    expect(brief.counts).toMatchObject({ "fact_missing:aov_net": 1, "fact_missing:revenue_net:month_to_date": 1 });
  });
});

describe("composeBrief: Risks (B3, C1)", () => {
  it("turns a detector finding into a plain sentence, direction in words", async () => {
    const found = await detections(DATE, { values: { revenue_net: 550000n } });
    const brief = composeBrief(input(DATE, [...(await briefFacts(DATE)), ...found.insights], { detectSummary: found.summary }));
    expect(texts(brief.risks.lines)).toEqual(["Net sales were ₹5,500, 45.0% below a normal Friday (₹10,000)."]);
    expect(brief.risks.lines[0]?.severity).toBe(3);
    expect(brief.risks.empty).toBeNull();
  });

  it("never cuts severity 3, and caps the rest at five with a count", async () => {
    const facts = await briefFacts(DATE);
    const sevThree = Array.from({ length: 6 }, (_, i) => detection({ producer: "detect.baseline", ruleId: `x.rule_${i}`, severity: 3 }));
    expect(composeBrief(input(DATE, [...facts, ...sevThree])).risks).toMatchObject({ more: null });
    expect(composeBrief(input(DATE, [...facts, ...sevThree])).risks.lines).toHaveLength(6);

    const mixed = [
      ...sevThree.slice(0, 2),
      ...Array.from({ length: 6 }, (_, i) => detection({ producer: "detect.baseline", ruleId: `y.rule_${i}`, severity: 2, deviationBps: -1000 * (i + 1) })),
    ];
    const brief = composeBrief(input(DATE, [...facts, ...mixed]));
    expect(brief.risks.lines).toHaveLength(RISK_CAP);
    expect(brief.risks.lines.slice(0, 2).every((l) => l.severity === 3)).toBe(true);
    expect(brief.risks.more?.text).toBe("and 3 more");
  });

  it("orders within a severity: payment-ledger findings first, then the larger change", async () => {
    const facts = await briefFacts(DATE);
    const small = detection({ producer: "detect.baseline", ruleId: "a.small", severity: 2, deviationBps: -2600 });
    const large = detection({ producer: "detect.baseline", ruleId: "a.large", severity: 2, deviationBps: -9000 });
    const ledger = detection({ producer: "recon.orders", ruleId: "recon.order_totals", severity: 2, deviationBps: 10000 });
    const brief = composeBrief(input(DATE, [...facts, small, large, ledger]));
    expect(brief.risks.lines.map((l) => l.insightIds[0])).toEqual([ledger.id, large.id, small.id]);
  });

  it("gives one line to one problem: double capture and capture-vs-total together", async () => {
    const facts = await briefFacts(DATE);
    const sig = detection({ producer: "sig.money", ruleId: "sig.double_capture", severity: 3 });
    const recon = detection({ producer: "recon.orders", ruleId: "recon.capture_vs_total", severity: 2 });
    const brief = composeBrief(input(DATE, [...facts, sig, recon]));
    expect(brief.risks.lines).toHaveLength(1);
    expect(brief.risks.lines[0]).toMatchObject({
      text: "Some orders were paid more than once, or paid a different amount from their bill.",
      severity: 3,
      insightIds: [sig.id, recon.id].sort(),
    });
  });

  it("lists explained findings as known issues, outside the cap", async () => {
    const facts = await briefFacts(DATE);
    const recon = detection({ producer: "recon.orders", ruleId: "recon.capture_vs_total", severity: 2 });
    const brief = composeBrief(input(DATE, [...facts, recon], { explainedBy: (i) => (i.id === recon.id ? "pay-4" : null) }));
    expect(brief.risks.lines).toEqual([]);
    expect(texts(brief.risks.known)).toEqual(["A payment records check found a problem that needs a look. Known issue, fix in pay-4."]);
    expect(brief.risks.empty).toBeNull();
  });

  it("says 'No risks found' only when every check ran", async () => {
    const facts = await briefFacts(DATE);
    expect(composeBrief(input(DATE, facts)).risks.empty?.text).toBe(EMPTY_RISKS.NO_RISKS);

    const partial = composeBrief(input(DATE, facts, { checks: { ...ALL_RAN, reconcile: "NOT_RUN", detect: "FAILED" } }));
    expect(partial.risks.empty?.text).toBe(EMPTY_RISKS.CHECKS_INCOMPLETE);
    expect(texts(partial.treatWithCare.lines)).toEqual(["Sales checks failed for Fri 11 Sep.", "Payment records checks did not run for Fri 11 Sep."]);
  });

  it("shows a pulse gap that recovered, and one still open at closing time as a risk", async () => {
    const facts = await briefFacts(DATE);
    const period = { start: `${DATE}T13:00:00+05:30`, end: `${DATE}T13:45:00+05:30` };
    const recovered = detection({ producer: "pulse.service", ruleId: "pulse.no_orders", templateId: "pulse.no_orders", period }, { status: "EXPIRED", statusReason: "CLEARED" });
    const atClose = detection(
      { producer: "pulse.service", ruleId: "pulse.no_orders", templateId: "pulse.no_orders", period: { start: `${DATE}T22:00:00+05:30`, end: `${DATE}T22:45:00+05:30` } },
      { status: "EXPIRED", statusReason: "CLOSING_TIME" },
    );
    const brief = composeBrief(input(DATE, [...facts, recovered, atClose]));
    expect(texts(brief.risks.lines)).toEqual(["No orders came in between 22:00 and 22:45."]);
    expect(texts(brief.risks.resolved)).toEqual(["No orders came in between 13:00 and 13:45. It recovered later in the day."]);
  });

  it("uses a superseded finding's replacement, and ignores retracted and later rows", async () => {
    const facts = await briefFacts(DATE);
    const replacement = detection({ producer: "detect.baseline", ruleId: "b.rule", severity: 2 });
    const old = detection({ producer: "detect.baseline", ruleId: "b.rule", severity: 3 }, { status: "SUPERSEDED", supersededBy: replacement.id });
    const retracted = detection({ producer: "detect.baseline", ruleId: "c.rule", severity: 3 }, { status: "RETRACTED" });
    const later = detection({ producer: "detect.baseline", ruleId: "d.rule", severity: 3 }, { createdAt: "2026-09-12T09:00:00+05:30" });
    const brief = composeBrief(input(DATE, [...facts, old, replacement, retracted, later]));
    expect(brief.risks.lines.map((l) => l.insightIds)).toEqual([[replacement.id]]);
    expect(brief.insightIds).not.toContain(later.id);
  });

  it("ignores insights for other days", async () => {
    const other = detection({ producer: "detect.baseline", ruleId: "e.rule", date: "2026-09-10" });
    const brief = composeBrief(input(DATE, [...(await briefFacts(DATE)), ...(await briefFacts("2026-09-10")), other]));
    expect(brief.risks.lines).toEqual([]);
    expect(brief.yesterday.lines).toHaveLength(6);
  });
});

describe("composeBrief: payment-ledger visibility (R2.2)", () => {
  it("gives a viewer without finance.view no ledger lines, no ledger check lines and a sales-only all-clear", async () => {
    const facts = await briefFacts(DATE);
    const recon = detection({ producer: "recon.orders", ruleId: "recon.order_totals", severity: 3 });
    const brief = composeBrief(input(DATE, [...facts, recon], { viewer: ANALYST, checks: { ...ALL_RAN, reconcile: "NOT_RUN" } }));
    expect(brief.risks.lines).toEqual([]);
    expect(brief.risks.empty?.text).toBe(EMPTY_RISKS.NO_RISKS_SALES_ONLY);
    expect(brief.restricted?.text).toBe("Payment checks are shown to finance roles only.");
    expect(brief.treatWithCare.lines).toEqual([]);
    expect(brief.insightIds).not.toContain(recon.id);
    expect(renderBriefText(brief)).not.toMatch(/[Pp]ayment records/);
  });

  it("restricts a viewer without finance.view even when no ledger finding exists", async () => {
    const brief = composeBrief(input(DATE, await briefFacts(DATE), { viewer: ANALYST }));
    expect(brief.restricted).not.toBeNull();
    expect(composeBrief(input(DATE, await briefFacts(DATE))).restricted).toBeNull();
  });
});

describe("composeBrief: Worth knowing and Treat with care (B2)", () => {
  it("puts an uncapped severity-1 finding under Worth knowing", async () => {
    const found = await detections(DATE, { values: { revenue_net: 1400000n } });
    const brief = composeBrief(input(DATE, [...(await briefFacts(DATE)), ...found.insights], { detectSummary: found.summary }));
    expect(brief.risks.lines).toEqual([]);
    expect(texts(brief.worthKnowing.lines)).toEqual(["Net sales were ₹14,000, 40.0% above a normal Friday (₹10,000)."]);
  });

  it("moves a finding on low-trust data to Treat with care, with the reason in words", async () => {
    const found = await detections(DATE, { values: { waste_cost: 900000n }, grades: { waste_cost: "LOW" } });
    const brief = composeBrief(input(DATE, [...(await briefFacts(DATE)), ...found.insights], { detectSummary: found.summary }));
    expect(brief.risks.lines).toEqual([]);
    expect(texts(brief.treatWithCare.lines)).toEqual([
      "Waste came to ₹9,000, against a usual ₹2,000 on a Friday. We could not fully confirm the data behind this: some items sold have no costed recipe.",
    ]);
  });

  it("merges trust drops on one signal into one line", async () => {
    const facts = await briefFacts(DATE);
    const low: TrustRef = { state: "MEASURED", score: 40, asOf: "2026-09-12T02:00:00+05:30", metricIds: ["waste_cost"], reasons: ["GRADE_LOW", "T4_WASTE_LOGGING"] };
    const drops = ["waste_cost", "food_cost_pct_theoretical"].map((ref) =>
      detection({ producer: "detect.baseline", ruleId: "trust.grade_dropped", severity: 1, subjectRef: ref, trust: low }),
    );
    const brief = composeBrief(input(DATE, [...facts, ...drops]));
    expect(texts(brief.treatWithCare.lines)).toEqual(["The data behind waste and food cost became less reliable: waste was not logged every day."]);
    expect(brief.treatWithCare.lines[0]?.insightIds).toEqual(drops.map((d) => d.id).sort());
  });

  it("names the comparisons the detectors skipped, by reason, and leaves out closed days and the unset target", async () => {
    const brief = composeBrief(
      input(DATE, await briefFacts(DATE), {
        detectSummary: {
          "not_evaluated:sales.below_weekday_baseline:insufficient_history": 1,
          "not_evaluated:sales.above_weekday_baseline:insufficient_history": 1,
          "not_evaluated:waste.spike:insufficient_history": 1,
          "not_evaluated:food_cost.above_target:no_target": 1,
          "not_evaluated:aov.shift:closed_day": 1,
          not_evaluated_insufficient_history: 3,
        },
      }),
    );
    expect(texts(brief.treatWithCare.lines)).toEqual(["Could not compare net sales and waste with a normal day: there are not enough past weeks to compare with yet."]);
  });

  it("reads a missing parity summary as not checked, never as zero", async () => {
    expect(parityFromSummary(null)).toEqual({ state: "NOT_CHECKED" });
    expect(parityFromSummary({ rows: 4 })).toEqual({ state: "NOT_CHECKED" });
    expect(parityFromSummary({ parity_checks: 0, parity_mismatches: 0, parity_missing_days: 0 })).toEqual({ state: "NOT_CHECKED" });
    expect(parityFromSummary({ parity_checks: 2, parity_mismatches: 0 })).toEqual({ state: "NOT_CHECKED" });
    expect(parityFromSummary({ parity_checks: 2, parity_mismatches: 0, parity_missing_days: 0 })).toEqual({ state: "CHECKED", matched: true });
    expect(parityFromSummary({ parity_checks: 2, parity_mismatches: 1, parity_missing_days: 0 })).toEqual({ state: "CHECKED", matched: false });

    const facts = await briefFacts(DATE);
    expect(texts(composeBrief(input(DATE, facts, { parity: parityFromSummary(null) })).treatWithCare.lines)).toEqual([
      "Daily figures were not checked against the P&L for Fri 11 Sep.",
    ]);
    expect(texts(composeBrief(input(DATE, facts, { parity: { state: "CHECKED", matched: false } })).treatWithCare.lines)).toEqual([
      "Daily figures did not match the P&L check for Fri 11 Sep, so treat totals with care.",
    ]);
  });

  it("caps Treat with care at three with a count, checks that did not run first", async () => {
    const brief = composeBrief(
      input(DATE, await briefFacts(DATE), {
        checks: { detect: "SUCCEEDED", reconcile: "NOT_RUN", signatures: "NOT_RUN" },
        parity: { state: "NOT_CHECKED" },
        detectSummary: { "not_evaluated:waste.spike:low_trust": 1, "not_evaluated:discount.spike:no_trust": 1 },
      }),
    );
    expect(brief.treatWithCare.lines).toHaveLength(TREAT_WITH_CARE_CAP);
    expect(brief.treatWithCare.lines.map((l) => l.key)).toEqual(["check:reconcile", "check:signatures", "check:parity"]);
    expect(brief.treatWithCare.more?.text).toBe("and 2 more");
  });

  it("keeps the fixed gaps in the footer, not in the daily lines", async () => {
    const brief = composeBrief(input(DATE, await briefFacts(DATE)));
    expect(brief.footer.length).toBeGreaterThan(0);
    expect(brief.treatWithCare.lines).toEqual([]);
  });
});

describe("composeBrief: as of", () => {
  it("shows the read time in IST", async () => {
    const brief = composeBrief(input(DATE, await briefFacts(DATE), { readAt: morningAfter(DATE) }));
    expect(brief.asOf.text).toBe("As of 07:30, Sat 12 Sep");
  });

  it("is deterministic for the same input", async () => {
    const facts = await briefFacts(DATE);
    const found = await detections(DATE, { values: { orders_paid: 10n } });
    const one = composeBrief(input(DATE, [...facts, ...found.insights]));
    const two = composeBrief(input(DATE, [...found.insights].reverse().concat(facts)));
    expect(renderBriefText(two)).toBe(renderBriefText(one));
    expect(two.insightIds).toEqual(one.insightIds);
  });

  it("parses stored rows through the contract before composing", () => {
    expect(() => stored({} as never)).toThrow();
  });
});

/**
 * The grounding test — the AI never invents a number (CLAUDE.md, IQ-2 §4, R2.10).
 *
 * Seven consecutive seeded days, each composed from what the real job bodies
 * write (brief FACTs, detector findings) plus hand-built ledger, pulse and
 * forecast rows. For every brief:
 * - every text and word part carries no digit;
 * - every figure part equals what `present()` renders for the insight it
 *   cites, and that insight is in the brief's pinned set;
 * - every date part re-derives from the brief's date, the read time or the
 *   cited insight's period;
 * - every count part counts what it says, and every ref is a card the cited
 *   finding names, through explainedBy or its own templateId;
 * - every number in the rendered text is accounted for by those parts;
 * - only FACT and DETECTION insights are cited, even when others are present.
 */
import { describe, expect, it } from "vitest";

import { addDays, startOfBusinessDay } from "@/lib/dates";
import { estimated, present, type Insight } from "@/lib/iq/engine";

import { DATE, briefFacts, detection, detections, input, nextId, stored, trust } from "./__test-support__/brief";
import { composeBrief, formatDate, instantFor, renderBriefText, unsignedText, type Brief, type BriefInput, type BriefLine, type BriefPart } from "./compose";
import { explainingCardOf } from "./templates";

const NUMBER = /\d+(?:[.,:]\d+)*/g;

function allLines(brief: Brief): BriefLine[] {
  const maybe: (BriefLine | null)[] = [
    brief.asOf,
    brief.notReady,
    brief.yesterday.heading,
    ...brief.yesterday.lines,
    ...brief.risks.lines,
    brief.risks.more,
    ...brief.risks.known,
    ...brief.risks.resolved,
    brief.risks.empty,
    ...brief.worthKnowing.lines,
    brief.worthKnowing.more,
    ...brief.treatWithCare.lines,
    brief.treatWithCare.more,
    brief.restricted,
  ];
  return maybe.filter((l): l is BriefLine => l !== null);
}

function expectedFigure(insight: Insight, part: Extract<BriefPart, { kind: "figure" }>): string {
  const p = present(insight);
  if (p.kind === "FACT" && part.slot === "value") return p.figure.text;
  if (p.kind === "DETECTION") {
    if (part.slot === "observed") return p.observed.text;
    if (part.slot === "baseline") return p.baseline.text;
    if (part.slot === "deviation") return part.unsigned ? unsignedText(p.deviation) : p.deviation;
  }
  throw new Error(`figure part ${part.slot} cannot come from a ${insight.claimType}`);
}

function expectGrounded(brief: Brief, briefInput: BriefInput): void {
  const byId = new Map(briefInput.insights.map((i) => [i.id, i]));
  const allowedNumbers = new Set<string>();
  const pinned = new Set(brief.insightIds);

  for (const line of allLines(brief)) {
    expect(line.parts.map((p) => p.text).join("")).toBe(line.text);
    for (const id of line.insightIds) {
      expect(pinned.has(id)).toBe(true);
      expect(["FACT", "DETECTION"]).toContain(byId.get(id)?.claimType);
    }
    for (const part of line.parts) {
      switch (part.kind) {
        case "text":
        case "word":
          expect(part.text, `digit in ${part.kind} part of "${line.text}"`).not.toMatch(/\d/);
          break;
        case "figure": {
          const insight = byId.get(part.insightId);
          expect(insight, `figure cites an insight not in the input: ${line.text}`).toBeDefined();
          expect(line.insightIds).toContain(part.insightId);
          expect(part.text).toBe(expectedFigure(insight!, part));
          break;
        }
        case "date": {
          let iso: string;
          if (part.source.from === "brief_date") iso = startOfBusinessDay(brief.date).toISOString();
          else if (part.source.from === "read_at") iso = briefInput.readAt.toISOString();
          else {
            const insight = byId.get(part.source.insightId)!;
            expect(line.insightIds).toContain(insight.id);
            iso = part.source.edge === "start" ? insight.period.start : insight.period.end;
          }
          expect(part.text).toBe(formatDate(instantFor(iso, part.format), part.format));
          break;
        }
        case "count":
          expect(part.text).toBe(String(part.value));
          expect(part.value).toBeGreaterThan(0);
          break;
        case "ref":
          // A card comes either from the explainedBy port or from the finding's own templateId; never from nowhere.
          expect(
            line.insightIds.some((id) => {
              const insight = byId.get(id)!;
              return briefInput.explainedBy?.(insight) === part.text || explainingCardOf(insight.copy.templateId) === part.text;
            }),
          ).toBe(true);
          break;
      }
      if (part.kind !== "text" && part.kind !== "word") for (const n of part.text.match(NUMBER) ?? []) allowedNumbers.add(n);
    }
  }

  for (const n of renderBriefText(brief).match(NUMBER) ?? []) {
    expect(allowedNumbers.has(n), `number "${n}" in the brief has no cited source`).toBe(true);
  }
}

/** One seeded day. Anomalies rotate so the week covers every section. */
async function seededDay(offset: number): Promise<BriefInput> {
  const date = addDays(DATE, offset);
  const facts = await briefFacts(date, {
    revenue_net: 900000n + BigInt(offset) * 25000n,
    orders_paid: 36 + offset,
    aov_net: 25000n + BigInt(offset) * 100n,
    food_cost_pct_theoretical: 3000 + offset * 35,
    net_collected: 1050000n - BigInt(offset) * 12345n,
    trust: offset % 3 === 0 ? { food_cost_pct_theoretical: trust("LOW", "t2_price_freshness") } : {},
  });
  const plants = [
    { values: { revenue_net: 550000n } },
    { values: { discount_share: 1500n } },
    { values: { orders_cancelled_failed: 12n } },
    { values: { waste_cost: 900000n }, grades: { waste_cost: "LOW" as const } },
    { values: { online_share: 5000n } },
    { values: { revenue_net: 1500000n } },
    {},
  ];
  const found = await detections(date, plants[offset]!);

  const recon = detection({ producer: "recon.orders", ruleId: "recon.capture_vs_total", severity: 2, date });
  const sig = detection({ producer: "sig.money", ruleId: "sig.double_capture", severity: 3, date, observed: 2n, baseline: 1n });
  const pulse = detection(
    { producer: "pulse.service", ruleId: "pulse.no_orders", templateId: "pulse.no_orders", date, period: { start: `${date}T15:15:00+05:30`, end: `${date}T16:00:00+05:30` } },
    { status: "EXPIRED", statusReason: "CLEARED" },
  );
  const base = Object.fromEntries(Object.entries(facts[0]!).filter(([key]) => key !== "statusReason" && key !== "supersededBy"));
  const forecast = stored({
    ...(base as Insight),
    id: nextId(),
    dedupeKey: `forecast:orders:${date}`,
    producer: "forecast.orders",
    claimType: "FORECAST",
    copy: { templateId: "forecast.orders", slots: { band: "interval" } },
    payload: {
      modelId: "orders.seasonal-naive",
      modelVersion: "1",
      horizonDays: 1,
      interval: { p10: estimated({ unit: "count", value: 30 }), p50: estimated({ unit: "count", value: 41 }), p90: estimated({ unit: "count", value: 55 }), nominalCoverage: 80 },
      backtest: { metric: "WAPE", modelErrorBps: 1800, naiveErrorBps: 2400, windowDays: 28, provenance: "LOCAL_SYNTHETIC" },
      isNaiveFallback: false,
      forecastIds: [nextId()],
    },
  } as Insight);

  // The money a capture mismatch involves, as reconcile-job.ts writes it: its
  // own insight, in paise, beside the count.
  const reconAmount = detection({
    producer: "recon.orders",
    ruleId: "recon.capture_vs_total.paise",
    severity: 2,
    date,
    unit: "paise",
    observed: 124050n + BigInt(offset) * 1000n,
  });
  // An explained double capture names its own card in the templateId; no port fills it in.
  const reconExplained = detection({
    producer: "recon.orders",
    ruleId: "recon.capture_vs_total.explained",
    templateId: "recon.explained.pay-4",
    severity: 2,
    date,
    observed: 2n,
  });

  const ledger = offset % 2 === 0 ? [recon, sig, reconAmount] : [recon, reconExplained];
  return input(date, [...facts, ...found.insights, ...ledger, pulse, forecast], {
    detectSummary: found.summary,
    parity: offset === 4 ? { state: "NOT_CHECKED" } : { state: "CHECKED", matched: true },
    checks: offset === 5 ? { detect: "SUCCEEDED", reconcile: "NOT_RUN", signatures: "SUCCEEDED" } : { detect: "SUCCEEDED", reconcile: "SUCCEEDED", signatures: "SUCCEEDED" },
    explainedBy: (i) => (offset === 1 && i.id === recon.id ? "pay-4" : null),
  });
}

describe("brief grounding: every number comes from a cited claim", () => {
  it("holds for seven consecutive seeded days, for the owner and for a viewer without finance.view", async () => {
    for (let offset = 0; offset < 7; offset += 1) {
      const dayInput = await seededDay(offset);
      for (const viewer of [{ financeView: true }, { financeView: false }]) {
        const brief = composeBrief({ ...dayInput, viewer });
        expect(brief.state).toBe("READY");
        expectGrounded(brief, { ...dayInput, viewer });
        const cited = brief.insightIds.map((id) => dayInput.insights.find((i) => i.id === id)!);
        expect(cited.some((i) => i.claimType === "FORECAST" || i.claimType === "RECOMMENDATION")).toBe(false);
        expect(renderBriefText(brief)).not.toMatch(/Forecast|forecast|expect|predict/);
        if (!viewer.financeView) expect(cited.some((i) => /^(recon|sig)\./.test(i.producer))).toBe(false);
      }
    }
  });

  it("pins the insight set: a row created after the read time changes nothing", async () => {
    const dayInput = await seededDay(0);
    const before = composeBrief(dayInput);
    const late = detection({ producer: "detect.baseline", ruleId: "late.rule", severity: 3, date: dayInput.date }, { createdAt: `${addDays(dayInput.date, 1)}T11:00:00+05:30` });
    const after = composeBrief({ ...dayInput, insights: [...dayInput.insights, late] });
    expect(after.insightIds).toEqual(before.insightIds);
    expect(renderBriefText(after)).toBe(renderBriefText(before));
  });

  it("catches a planted invented number", async () => {
    const dayInput = await seededDay(0);
    const brief = composeBrief(dayInput);
    const line = brief.yesterday.lines[0]!;
    const forged = { ...line, parts: [...line.parts, { kind: "word" as const, text: " up 12%" }], text: `${line.text} up 12%` };
    const tampered: Brief = { ...brief, yesterday: { ...brief.yesterday, lines: [forged, ...brief.yesterday.lines.slice(1)] } };
    expect(() => expectGrounded(tampered, dayInput)).toThrow();

    const wrongFigure = { ...line, parts: line.parts.map((p) => (p.kind === "figure" ? { ...p, text: "₹99,999" } : p)) };
    const tampered2: Brief = { ...brief, yesterday: { ...brief.yesterday, lines: [{ ...wrongFigure, text: wrongFigure.parts.map((p) => p.text).join("") }, ...brief.yesterday.lines.slice(1)] } };
    expect(() => expectGrounded(tampered2, dayInput)).toThrow();
  });
});

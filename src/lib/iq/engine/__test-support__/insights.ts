/** Raw insight rows for the engine's tests — one valid example per claim type. */
const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ACTION = "44444444-4444-4444-8444-444444444444";
const REC = "55555555-5555-4555-8555-555555555555";
const FORECAST_ROW = "66666666-6666-4666-8666-666666666666";

export const IDS = { ORG, RUN, OTHER, ACTION, REC, FORECAST_ROW };

const paise = (value: string) => ({ unit: "paise", value });

function base(id: string) {
  return {
    id,
    orgId: ORG,
    locationId: null,
    schemaVersion: 1,
    producer: "nightly-facts",
    subject: { kind: "ORG", ref: "org" },
    period: { start: "2026-09-16T00:00:00+05:30", end: "2026-09-16T23:59:59+05:30" },
    dedupeKey: `test:${id}`,
    evidence: [
      { kind: "metric", metricId: "revenue.net", period: { start: "2026-09-16T00:00:00+05:30", end: "2026-09-16T23:59:59+05:30" } },
    ],
    trust: { state: "NOT_MEASURED" },
    copy: { templateId: "none", slots: {} },
    status: "ACTIVE",
    producedBy: { job: "nightly-facts", runId: RUN, attempt: 1, codeVersion: "cb2bd04" },
    contentHash: "a".repeat(64),
    supersedes: null,
    createdAt: "2026-09-17T03:00:00+05:30",
    expiresAt: null,
  };
}

export function rawFact() {
  return {
    ...base("aaaaaaaa-0000-4000-8000-000000000001"),
    claimType: "FACT",
    copy: { templateId: "fact.revenue", slots: { amount: "value" } },
    payload: { metricId: "revenue.net", value: paise("4250000"), sourceQueryId: "orders.net-revenue" },
  };
}

export function rawDetection() {
  return {
    ...base("aaaaaaaa-0000-4000-8000-000000000002"),
    claimType: "DETECTION",
    payload: {
      ruleId: "food-cost.above-baseline",
      observed: { unit: "bps", value: 3400 },
      baseline: { method: "median_mad", value: { unit: "bps", value: 3000 }, windowWeeks: 8 },
      deviationBps: 1333,
      severity: 2,
    },
  };
}

export function rawForecast() {
  return {
    ...base("aaaaaaaa-0000-4000-8000-000000000003"),
    claimType: "FORECAST",
    copy: { templateId: "forecast.orders", slots: { band: "interval", days: "horizonDays" } },
    payload: {
      modelId: "orders.seasonal-naive",
      modelVersion: "1",
      horizonDays: 1,
      interval: {
        p10: { unit: "count", value: 120 },
        p50: { unit: "count", value: 150 },
        p90: { unit: "count", value: 190 },
        nominalCoverage: 80,
      },
      backtest: { metric: "WAPE", modelErrorBps: 1800, naiveErrorBps: 2400, windowDays: 28, provenance: "LOCAL_SYNTHETIC" },
      isNaiveFallback: false,
      forecastIds: [FORECAST_ROW],
    },
  };
}

export function rawExplanation() {
  return {
    ...base("aaaaaaaa-0000-4000-8000-000000000004"),
    claimType: "EXPLANATION",
    copy: { templateId: "why.revenue", slots: { residual: "residual", total: "total" } },
    payload: {
      method: "additive",
      total: paise("-500000"),
      drivers: [
        { driverId: "orders.count", contribution: paise("-400000") },
        { driverId: "ticket.average", contribution: paise("-80000") },
      ],
      residual: paise("-20000"),
    },
  };
}

export function rawRecommendation() {
  const expiresAt = "2026-09-18T11:00:00+05:30";
  return {
    ...base("aaaaaaaa-0000-4000-8000-000000000005"),
    claimType: "RECOMMENDATION",
    expiresAt,
    copy: { templateId: "rec.prep", slots: { impact: "impact" } },
    payload: {
      recommendationId: REC,
      actionKind: "prep_list.prefill",
      tier: "A1",
      impact: { low: paise("150000"), high: paise("300000"), basis: "forecast" },
      assumptions: [{ code: "DEMAND_AS_FORECAST" }],
      confidence: { level: "MEDIUM", reasons: ["SHORT_HISTORY"] },
      expiresAt,
      evidenceInsightIds: [OTHER],
    },
  };
}

export function rawAutomation() {
  return {
    ...base("aaaaaaaa-0000-4000-8000-000000000006"),
    claimType: "AUTOMATION",
    payload: {
      actionId: ACTION,
      actionKind: "purchase_order.create_draft",
      tier: "A1",
      execution: "EXECUTED",
      approvalRef: { autoPolicyId: OTHER, autoPolicyVersion: 3 },
      before: { status: null },
      after: { status: "DRAFT", lines: 4 },
      undo: { kind: "REVERT", available: true },
    },
  };
}

export const RAW_BY_CLAIM = {
  FACT: rawFact,
  DETECTION: rawDetection,
  FORECAST: rawForecast,
  EXPLANATION: rawExplanation,
  RECOMMENDATION: rawRecommendation,
  AUTOMATION: rawAutomation,
} as const;

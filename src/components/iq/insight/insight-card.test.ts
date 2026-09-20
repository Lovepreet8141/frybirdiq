import { describe, expect, it } from "vitest";
import { RAW_BY_CLAIM } from "@/lib/iq/engine/__test-support__/insights";
import { InsightSchema, type Insight } from "@/lib/iq/engine/insight";
import { present } from "@/lib/iq/engine/present";
import { forPresentation, titleFor } from "./insight-card";

const parse = (raw: unknown): Insight => InsightSchema.parse(raw);

describe("titleFor", () => {
  it("a caller-supplied title wins", () => {
    expect(titleFor(present(parse(RAW_BY_CLAIM.DETECTION())), "Food cost is running high")).toBe("Food cost is running high");
  });

  it("FACT falls back to the metric's owner-facing label, never the id", () => {
    expect(titleFor(present(parse(RAW_BY_CLAIM.FACT())))).toBe("Net sales (excl. GST)");
  });

  it("other kinds fall back to a neutral word, never the rule id", () => {
    expect(titleFor(present(parse(RAW_BY_CLAIM.DETECTION())))).toBe("Finding");
  });
});

describe("forPresentation", () => {
  it("FACT: neutral tone, metric label as the title, the figure as the impact", () => {
    const shape = forPresentation(present(parse(RAW_BY_CLAIM.FACT())));
    expect(shape.tone).toBe("neutral");
    expect(shape.title).toBe("Net sales (excl. GST)");
    expect(shape.impact).toBe("₹42,500");
  });

  it("DETECTION: severity 2 gets flag tone and a CHECK level, observed vs baseline in the evidence", () => {
    const shape = forPresentation(present(parse(RAW_BY_CLAIM.DETECTION())));
    expect(shape.tone).toBe("flag");
    expect(shape.level).toBe("CHECK");
    expect(shape.title).toBe("Finding");
    expect(shape.impact).toBe("34.0%");
    expect(shape.evidence).toBe("Usual 30.0% · 13.3%");
  });

  it("DETECTION: severity 3 gets loss tone and an URGENT level", () => {
    const raw = RAW_BY_CLAIM.DETECTION();
    const sev3 = { ...raw, payload: { ...raw.payload, severity: 3 } };
    const shape = forPresentation(present(parse(sev3)));
    expect(shape.tone).toBe("loss");
    expect(shape.level).toBe("URGENT");
  });

  it("DETECTION: severity 1 gets neutral tone and a NOTE level", () => {
    const raw = RAW_BY_CLAIM.DETECTION();
    const sev1 = { ...raw, payload: { ...raw.payload, severity: 1 } };
    const shape = forPresentation(present(parse(sev1)));
    expect(shape.tone).toBe("neutral");
    expect(shape.level).toBe("NOTE");
  });

  it("FORECAST: neutral tone, the band as the impact, coverage and horizon in the label", () => {
    const shape = forPresentation(present(parse(RAW_BY_CLAIM.FORECAST())));
    expect(shape.tone).toBe("neutral");
    expect(shape.impact).toBe("120 – 190");
    expect(shape.impactLabel).toBe("80% interval, next 1d");
  });

  it("EXPLANATION: the total as the impact, every driver plus the residual in the evidence", () => {
    const shape = forPresentation(present(parse(RAW_BY_CLAIM.EXPLANATION())));
    expect(shape.impact).toBe("-₹5,000");
    expect(shape.evidence).toBe("Orders count: -₹4,000 · Ticket average: -₹800 · Residual ≈ -₹200");
  });

  it("RECOMMENDATION: gain tone, the impact range labelled as an estimate", () => {
    const shape = forPresentation(present(parse(RAW_BY_CLAIM.RECOMMENDATION())));
    expect(shape.tone).toBe("gain");
    expect(shape.impact).toBe("₹1,500 – ₹3,000");
    expect(shape.impactLabel).toBe("Estimated impact");
  });

  it("AUTOMATION: tone follows the badge label (Done automatically -> gain)", () => {
    const shape = forPresentation(present(parse(RAW_BY_CLAIM.AUTOMATION())));
    expect(shape.tone).toBe("gain");
  });

  it("AUTOMATION waiting for approval: tone follows the badge label (Waiting approval -> flag)", () => {
    const raw = RAW_BY_CLAIM.AUTOMATION();
    const pending = { ...raw, payload: { ...raw.payload, execution: "PENDING_APPROVAL", approvalRef: null } };
    const shape = forPresentation(present(parse(pending)));
    expect(shape.tone).toBe("flag");
  });
});

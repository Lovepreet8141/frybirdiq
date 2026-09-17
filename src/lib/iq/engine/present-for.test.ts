import { describe, expect, it } from "vitest";

import { RAW_BY_CLAIM, rawFact } from "./__test-support__/insights";
import { InsightSchema, type Insight } from "./insight";
import { LEDGER_PRODUCER_PREFIXES, isLedgerInsight, presentFor, viewerFor } from "./present-for";

const parse = (raw: unknown): Insight => InsightSchema.parse(raw);

function ledger(producer: string, dedupeKey: string): Insight {
  return parse({ ...rawFact(), id: "aaaaaaaa-0000-4000-8000-0000000000aa", producer, dedupeKey });
}

describe("viewerFor", () => {
  it.each([
    [["OWNER"], true],
    [["MANAGER"], true],
    [["ADMIN"], false],
    [["ANALYST"], false],
    [["CASHIER"], false],
  ] as const)("%j → financeView %s", (roles, financeView) => {
    expect(viewerFor(roles)).toEqual({ financeView });
  });
});

describe("presentFor", () => {
  const recon = ledger("recon.capture_vs_total", "recon:capture_vs_total:2026-09-11");
  const sig = ledger("sig.double_capture", "sig:double_capture");
  const ordinary = Object.values(RAW_BY_CLAIM).map((raw) => parse(raw()));

  it("uses the same producer prefixes as the 0037 RLS policy", () => {
    expect(LEDGER_PRODUCER_PREFIXES).toEqual(["recon.", "sig."]);
    expect([isLedgerInsight(recon), isLedgerInsight(sig), isLedgerInsight(ordinary[0]!)]).toEqual([true, true, false]);
  });

  it("shows ledger findings to a finance viewer, and restricts nothing", () => {
    const out = presentFor([recon, sig, ...ordinary], { financeView: true });
    expect(out.items.map((p) => p.insightId)).toContain(recon.id);
    expect(out.items).toHaveLength(2 + ordinary.length);
    expect(out.restricted).toBe(false);
  });

  it("hides ledger findings from everyone else, with no count", () => {
    const out = presentFor([recon, sig, ...ordinary], { financeView: false });
    expect(out.items).toHaveLength(ordinary.length);
    expect(out).toEqual({ items: expect.any(Array), restricted: true });
  });

  it("reports restricted even when there is nothing to hide, so existence never leaks", () => {
    expect(presentFor(ordinary, { financeView: false }).restricted).toBe(true);
    expect(presentFor([], { financeView: false }).restricted).toBe(true);
  });
});

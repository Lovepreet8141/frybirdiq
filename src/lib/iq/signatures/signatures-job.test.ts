import { describe, expect, it, vi } from "vitest";

import { InsightSchema, findPersonalData } from "@/lib/iq/engine";

import { ORG, allReadings } from "./__test-support__/readings";
import { PRE_REFUND_SIGNATURES } from "./pre-refund";
import { runMoneySignatures, signatureParamsHash, type SignatureWriter, type SignaturesJobPorts } from "./signatures-job";

const NOW = new Date("2026-09-17T06:10:00Z"); // 11:40 IST

function ports(readings: ReturnType<typeof allReadings>, now = NOW) {
  const written: Parameters<SignatureWriter["writeInsight"]>[0][] = [];
  const expired: Parameters<SignatureWriter["expireInsights"]>[0][] = [];
  const writer: SignatureWriter = {
    writeInsight: vi.fn(async (insight) => {
      written.push(insight);
      return { outcome: "INSERTED" };
    }),
    expireInsights: vi.fn(async (requests) => {
      expired.push(requests);
      return { expired: requests.length };
    }),
  };
  let n = 0;
  const p: SignaturesJobPorts = {
    orgId: ORG,
    runId: "7b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    attempt: 1,
    codeVersion: "abc1234",
    readSignatures: vi.fn(async () => readings),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    now: () => now,
    commit: (write) => write(writer),
  };
  return { p, written, expired, writer };
}

describe("runMoneySignatures (IQ-2 S5 job body)", () => {
  it("reads every rule, writes one valid DETECTION per fired rule, and expires only the clear ones", async () => {
    const { p, written, expired } = ports(allReadings({ "sig.double_capture": 1, "sig.claim_stuck": 3 }));
    const result = await runMoneySignatures(p);

    expect(p.readSignatures).toHaveBeenCalledWith(PRE_REFUND_SIGNATURES.map((r) => r.ruleId));
    expect(written.map((i) => i.dedupeKey).sort()).toEqual(["sig:sig.claim_stuck", "sig:sig.double_capture"]);
    for (const insight of written) {
      expect(InsightSchema.safeParse(insight).success).toBe(true);
      expect(insight.producer.startsWith("sig.")).toBe(true);
      expect(insight.claimType).toBe("DETECTION");
      expect(insight.trust).toEqual({ state: "NOT_MEASURED" });
      expect(insight.period.end).toBe("2026-09-17T11:40:00+05:30");
      expect(findPersonalData(insight)).toEqual([]);
    }
    const claim = written.find((i) => i.dedupeKey === "sig:sig.claim_stuck");
    expect(claim?.payload).toMatchObject({ ruleId: "sig.claim_stuck", observed: { unit: "count", value: 3 }, baseline: { method: "threshold", windowWeeks: 0 }, severity: 2, deviationBps: 10_000 });
    expect(expired).toHaveLength(1);
    expect(expired[0]!.map((r) => r.dedupeKey)).toHaveLength(5);
    expect(expired[0]!.every((r) => r.reason === "CLEARED" && r.asOf === "2026-09-17T11:40:00+05:30")).toBe(true);
    expect(result).toEqual({ status: "COMPLETE", rowsWritten: 7, summary: { rules_fired: 2, rules_clear: 5, rule_timeout: 0, insight_inserted: 2, insights_expired: 5 } });
  });

  it("a rule that timed out is neither written nor expired", async () => {
    const readings = allReadings({ "sig.half_order": 1 });
    readings[3] = { ruleId: "sig.half_order", status: "RULE_TIMEOUT" };
    const { p, written, expired } = ports(readings);
    const result = await runMoneySignatures(p);
    expect(written).toHaveLength(0);
    expect(expired[0]!.map((r) => r.dedupeKey)).not.toContain("sig:sig.half_order");
    expect(result.status === "COMPLETE" && result.summary.rule_timeout).toBe(1);
  });

  it("keeps an unchanged finding's content hash stable from one hour to the next", async () => {
    const first = ports(allReadings({ "sig.webhook_failed": 1 }));
    const second = ports(allReadings({ "sig.webhook_failed": 1 }), new Date(NOW.getTime() + 60 * 60_000));
    await runMoneySignatures(first.p);
    await runMoneySignatures(second.p);
    expect(second.written[0]!.contentHash).toBe(first.written[0]!.contentHash);
    const changed = ports(allReadings({ "sig.webhook_failed": 2 }));
    await runMoneySignatures(changed.p);
    expect(changed.written[0]!.contentHash).not.toBe(first.written[0]!.contentHash);
    expect(first.written[0]!.evidence).toEqual([{ kind: "query", sourceId: "sig.webhook_failed", paramsHash: await signatureParamsHash(ORG, "sig.webhook_failed") }]);
  });

  it("writes nothing and expires everything on a clean org", async () => {
    const { p, written, expired } = ports(allReadings());
    const result = await runMoneySignatures(p);
    expect(written).toHaveLength(0);
    expect(expired[0]).toHaveLength(7);
    expect(result).toMatchObject({ status: "COMPLETE", rowsWritten: 7 });
  });
});

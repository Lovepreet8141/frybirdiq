import { describe, expect, it } from "vitest";

import { InsightSchema } from "@/lib/iq/engine";
import { observed, observedPaise } from "@/lib/iq/engine/observed-factory";
import { paise } from "@/lib/money";

import { type ReconExpireRequest, type ReconRunRead, UpstreamNotReady, reconKeys, runReconcileNightly } from "./reconcile-job";
import type { ReconOutcome } from "./rules";

const ORG = "11111111-1111-4111-8111-111111111111";
const D = "2026-09-10";

function ports(read: ReconRunRead, options: { factsReady?: boolean } = {}) {
  const written: unknown[] = [];
  const expired: ReconExpireRequest[] = [];
  let n = 0;
  return {
    written,
    expired,
    ports: {
      orgId: ORG,
      runId: "22222222-2222-4222-8222-222222222222",
      attempt: 1,
      codeVersion: "48c428a",
      date: D,
      factsReady: async () => options.factsReady ?? true,
      readRecon: async () => read,
      newId: () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      now: () => new Date("2026-09-11T21:00:00Z"),
      commit: async <T,>(write: (w: { writeInsight: (i: never, o: { asOf: string }) => Promise<{ outcome: string }>; expireInsights: (r: readonly ReconExpireRequest[]) => Promise<{ expired: number }> }) => Promise<T>) =>
        write({
          writeInsight: async (insight) => {
            written.push(insight);
            return { outcome: "INSERTED" };
          },
          expireInsights: async (requests) => {
            expired.push(...requests);
            return { expired: requests.length };
          },
        }),
    },
  };
}

const read = (outcomes: ReconRunRead["outcomes"]): ReconRunRead => ({
  from: D,
  to: D,
  outcomes,
  zeroCount: observed({ unit: "count", value: 0 }),
  zeroPaise: observedPaise(0n),
  trustByDate: { [D]: { grade: "MEDIUM", signalId: "t6_payment_integrity", ratio: { numerator: 9n, denominator: 10n }, asOf: "2026-09-11T02:00:00+05:30" } },
});

describe("runReconcileNightly", () => {
  it("refuses to read anything until the day's facts are final", async () => {
    const p = ports(read([]), { factsReady: false });
    await expect(runReconcileNightly(p.ports as never)).rejects.toBeInstanceOf(UpstreamNotReady);
    expect(p.written).toEqual([]);
  });

  it("writes unexplained, explained and paise DETECTIONs, and expires only keys a rule evaluated", async () => {
    const fired: ReconOutcome = { ruleId: "recon.capture_vs_total", date: D, status: "FIRED", unexplained: 1, explained: 2, explainedBy: "pay-4", amount: paise(18_900n), breaks: { MULTIPLE_CAPTURES: 2, AMOUNT_MISMATCH: 1 } };
    const p = ports(
      read([
        { outcome: fired, counts: { unexplained: observed({ unit: "count", value: 1 }), explained: observed({ unit: "count", value: 2 }), amount: observedPaise(18_900n) } },
        { outcome: { ruleId: "recon.order_totals", date: D, status: "CLEAR" }, counts: null },
        { outcome: { ruleId: "recon.gst_lines", date: D, status: "NOT_EVALUATED", reason: "rule_timeout" }, counts: null },
      ]),
    );
    const result = await runReconcileNightly(p.ports as never);

    const insights = p.written.map((row) => InsightSchema.parse(row));
    expect(insights.map((i) => [i.dedupeKey, i.producer, i.copy.templateId, i.trust.state])).toEqual([
      ["recon:recon.capture_vs_total:2026-09-10", "recon.nightly", "recon.capture_vs_total", "MEASURED"],
      ["recon:recon.capture_vs_total.explained:2026-09-10", "recon.nightly", "recon.explained.pay-4", "MEASURED"],
      ["recon:recon.capture_vs_total.paise:2026-09-10", "recon.nightly", "recon.capture_vs_total.paise", "MEASURED"],
    ]);
    expect(p.expired.map((r) => r.dedupeKey)).toEqual([...reconKeys("recon.order_totals", D)]);
    expect(p.expired.every((r) => r.asOf === "2026-09-11T00:00:00+05:30" && r.reason === "CLEARED")).toBe(true);
    expect(result).toMatchObject({ status: "COMPLETE", rowsWritten: 6, summary: expect.objectContaining({ fired: 1, clear: 1, not_evaluated: 1, rule_timeout: 1, unexplained: 1, explained: 2 }) });
  });
});

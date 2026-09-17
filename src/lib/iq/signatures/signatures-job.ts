/**
 * iq-money-signatures — the job body for the money crash signatures (IQ-2 S5;
 * R2.1 thin adapter + domain body, R2.4 expire only evaluated keys, R2.7).
 *
 * Pure orchestration over ports: no database, no repository import. The
 * adapter in `src/lib/jobs/jobs/` (AUTOMATION-ARCHITECT) binds the ports to
 * `ctx.repos` and `ctx.commit`, and `readSignatures` to
 * `readMoneySignatures` in `src/lib/repositories/iq-signatures.ts`.
 *
 * One run, for one org, at the hour it runs:
 * 1. reads every rule (each its own read-only transaction, R2.5);
 * 2. decides each rule (`pre-refund.ts`);
 * 3. in one fenced chunk, writes a DETECTION for each FIRED rule under its
 *    stable key `sig:<ruleId>`, and expires the ACTIVE finding of each CLEAR
 *    rule. A rule that timed out is not touched (counted `rule_timeout`).
 *
 * Signatures are exact row-state checks, not figures scored for trust:
 * their trust is NOT_MEASURED, and they are never trust-gated (§2).
 */
import { canonicalJson, computeContentHash, sha256Hex, type Evidence, type InsightOf } from "@/lib/iq/engine";
import type { JobRunResult } from "@/lib/jobs/context";

import { PRE_REFUND_SIGNATURES, SIGNATURE_RULE_VERSION, evaluateSignatures, type SignatureOutcome, type SignatureReading, type SignatureRuleId } from "./pre-refund";

export const SIGNATURES_JOB_NAME = "iq-money-signatures";

export type SignatureExpireRequest = { readonly dedupeKey: string; readonly asOf: string; readonly reason: "CLEARED" };

/** Writers inside the fenced chunk. */
export type SignatureWriter = {
  readonly writeInsight: (insight: InsightOf<"DETECTION">, options: { readonly asOf: string }) => Promise<{ readonly outcome: string }>;
  readonly expireInsights: (requests: readonly SignatureExpireRequest[]) => Promise<{ readonly expired: number }>;
};

export type SignaturesJobPorts = {
  readonly orgId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly codeVersion: string;
  /** Reads the given rules for this org (`readMoneySignatures`, org closed over by the adapter). */
  readonly readSignatures: (ruleIds: readonly SignatureRuleId[]) => Promise<readonly SignatureReading[]>;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly commit: <T>(write: (writer: SignatureWriter) => Promise<T>) => Promise<T>;
};

/** An instant as an ISO timestamp in IST with an explicit +05:30 offset. */
export function istTimestamp(at: Date): string {
  const shifted = new Date(at.getTime() + 330 * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}

/**
 * The evidence hash for a rule: org, rule and rule version only (R2.4), so an
 * unchanged finding keeps an unchanged content hash from one hour to the next.
 */
export async function signatureParamsHash(orgId: string, ruleId: SignatureRuleId): Promise<string> {
  return sha256Hex(canonicalJson({ orgId, ruleId, ruleVersion: SIGNATURE_RULE_VERSION }));
}

type Fired = Extract<SignatureOutcome, { status: "FIRED" }>;

export async function signatureInsight(
  outcome: Fired,
  meta: Pick<SignaturesJobPorts, "orgId" | "runId" | "attempt" | "codeVersion" | "newId"> & { readonly asOf: string; readonly periodStart: string },
): Promise<InsightOf<"DETECTION">> {
  const evidence: Evidence[] = [{ kind: "query", sourceId: outcome.ruleId, paramsHash: await signatureParamsHash(meta.orgId, outcome.ruleId) }];
  const payload: InsightOf<"DETECTION">["payload"] = {
    ruleId: outcome.ruleId,
    observed: outcome.count,
    baseline: { method: "threshold", value: outcome.threshold, windowWeeks: 0 },
    // Defined, not measured: any count above the zero threshold is a full breach (§1).
    deviationBps: 10_000,
    severity: outcome.severity,
  };
  return {
    id: meta.newId(),
    orgId: meta.orgId,
    locationId: null,
    schemaVersion: 1,
    // Starts with `sig.`: the ledger-class prefix that gates visibility on finance.view (R2.2).
    producer: outcome.ruleId,
    subject: { kind: "ORG", ref: meta.orgId },
    period: { start: meta.periodStart, end: meta.asOf },
    dedupeKey: outcome.dedupeKey,
    evidence,
    trust: { state: "NOT_MEASURED" },
    copy: { templateId: outcome.ruleId, slots: { count: "observed" } },
    status: "ACTIVE",
    producedBy: { job: SIGNATURES_JOB_NAME, runId: meta.runId, attempt: meta.attempt, codeVersion: meta.codeVersion },
    contentHash: await computeContentHash({ payload, evidence }),
    supersedes: null,
    createdAt: meta.asOf,
    expiresAt: null,
    claimType: "DETECTION",
    payload,
  };
}

export async function runMoneySignatures(ports: SignaturesJobPorts): Promise<JobRunResult> {
  const readings = await ports.readSignatures(PRE_REFUND_SIGNATURES.map((rule) => rule.ruleId));
  const evaluation = evaluateSignatures(readings);

  const now = ports.now();
  const asOf = istTimestamp(now);
  const periodStart = istTimestamp(new Date(now.getTime() - 60 * 60_000));
  const fired = evaluation.outcomes.filter((o): o is Fired => o.status === "FIRED");
  const insights = await Promise.all(fired.map((o) => signatureInsight(o, { ...ports, asOf, periodStart })));
  const clears: SignatureExpireRequest[] = evaluation.outcomes.filter((o) => o.status === "CLEAR").map((o) => ({ dedupeKey: o.dedupeKey, asOf, reason: "CLEARED" as const }));

  const summary: Record<string, number> = { ...evaluation.summary };
  const { writes, expired } = await ports.commit(async (writer) => {
    const results: string[] = [];
    for (const insight of insights) results.push((await writer.writeInsight(insight, { asOf })).outcome);
    const expiredResult = clears.length > 0 ? await writer.expireInsights(clears) : { expired: 0 };
    return { writes: results, expired: expiredResult.expired };
  });

  for (const outcome of writes) summary[`insight_${outcome.toLowerCase()}`] = (summary[`insight_${outcome.toLowerCase()}`] ?? 0) + 1;
  summary.insights_expired = expired;
  const rowsWritten = writes.filter((o) => o !== "NOOP").length + expired;
  return { status: "COMPLETE", rowsWritten, summary };
}

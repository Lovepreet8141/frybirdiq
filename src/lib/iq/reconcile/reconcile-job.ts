/**
 * iq-reconcile-nightly — the job body for IQ-2 S4 (reconciliation).
 *
 * hive/reviews/iq-2/DESIGN.md §1a and Revision 2 (R2.1 thin adapter + domain
 * body, R2.4 expire only evaluated keys, R2.5 read path, R2.6 rules, R2.8
 * upstream gate). Pure orchestration over ports: no database, no repository
 * import. The adapter `src/lib/jobs/jobs/reconcile.ts` (AUTOMATION-ARCHITECT)
 * binds the ports to `ctx.repos` / `ctx.commit`, as for detect.
 *
 * One run, for IST business day D:
 * 1. refuses unless the facts run for D is final (UpstreamNotReady);
 * 2. reads every rule over D and the 35 days before it, each rule in its own
 *    read-only snapshot (`readRecon`, from `iq-recon.ts`);
 * 3. writes DETECTIONs for what fired, in one fenced chunk:
 *    - `recon:<rule>:<day>` — findings no known card explains (the Done-when count);
 *    - `recon:<rule>.explained:<day>` — findings a card explains, still shown;
 *    - `recon:<rule>.paise:<day>` — the money involved, when the rule is about an amount;
 * 4. expires, in the same chunk, those keys for every day a rule evaluated
 *    and found clear. A rule that timed out, or a day without facts for
 *    parity, is never expired.
 *
 * Every insight's producer starts `recon.`, so 0037's RLS and `presentFor`
 * keep it to finance.view (R2.2). Trust is MEASURED from the day's
 * t6_payment_integrity signal when scored (these rules are its source) and
 * never gates publication.
 */
import { addDays } from "@/lib/dates";
import { UpstreamNotReady, istDayStart, istTimestamp } from "@/lib/iq/detect/detect-job";
import { type Evidence, type FigureTrust, type InsightOf, type Observed, type TrustRef, canonicalJson, computeContentHash, sha256Hex, trustRefFor } from "@/lib/iq/engine";
import type { JobRunResult } from "@/lib/jobs/context";

import { RECON_RULE_IDS, RECON_RULE_VERSION, RECON_SEVERITY, type ReconOutcome, type ReconRuleId } from "./rules";

export { UpstreamNotReady };

export const RECONCILE_JOB_NAME = "iq-reconcile-nightly";
export const RECON_PRODUCER = "recon.nightly";
/** The trust signal these rules feed. */
export const RECON_TRUST_SIGNAL = "t6_payment_integrity";

/** A fired outcome's figures, minted Observed by the repository that read them. */
export type ReconCounts = {
  readonly unexplained: Observed;
  readonly explained: Observed;
  /** Paise; null when the rule is not about an amount or the amount is zero. */
  readonly amount: Observed | null;
};

export type ReconRunRead = {
  /** First and last IST day evaluated. */
  readonly from: string;
  readonly to: string;
  readonly outcomes: readonly { readonly outcome: ReconOutcome; readonly counts: ReconCounts | null }[];
  /** Observed zero baselines (count and paise), minted by the repository. */
  readonly zeroCount: Observed;
  readonly zeroPaise: Observed;
  /** The day's t6_payment_integrity trust, or null when the day has no trust rows. */
  readonly trustByDate: Readonly<Record<string, FigureTrust | null>>;
};

export type ReconExpireRequest = { readonly dedupeKey: string; readonly asOf: string; readonly reason: "CLEARED" };

export type ReconWriter = {
  readonly writeInsight: (insight: InsightOf<"DETECTION">, options: { readonly asOf: string }) => Promise<{ readonly outcome: string }>;
  readonly expireInsights: (requests: readonly ReconExpireRequest[]) => Promise<{ readonly expired: number }>;
};

export type ReconcileJobPorts = {
  readonly orgId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly codeVersion: string;
  /** The IST business day the run is for (D). */
  readonly date: string;
  /** True when the facts for `date` are final (R2.8). */
  readonly factsReady: (date: string) => Promise<boolean>;
  readonly readRecon: (date: string, now: Date) => Promise<ReconRunRead>;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly commit: <T>(write: (writer: ReconWriter) => Promise<T>) => Promise<T>;
};

export function reconDedupeKey(ruleId: string, date: string): string {
  return `recon:${ruleId}:${date}`;
}

/** The three keys one rule can hold for a day. */
export function reconKeys(ruleId: ReconRuleId, date: string): readonly string[] {
  return [reconDedupeKey(ruleId, date), reconDedupeKey(`${ruleId}.explained`, date), reconDedupeKey(`${ruleId}.paise`, date)];
}

/** Evidence: the rule's query, re-runnable for the org and day (no order ids in the payload, R2.4). */
export async function reconEvidence(orgId: string, ruleId: ReconRuleId, date: string): Promise<Evidence[]> {
  const paramsHash = await sha256Hex(canonicalJson({ orgId, from: date, to: date, ruleVersion: RECON_RULE_VERSION }));
  return [{ kind: "query", sourceId: ruleId, paramsHash }];
}

function reconTrust(trust: FigureTrust | null | undefined): TrustRef {
  return trust ? trustRefFor(RECON_TRUST_SIGNAL, trust) : { state: "INSUFFICIENT_DATA", reasons: ["NO_TRUST_ROWS"] };
}

type Fired = Extract<ReconOutcome, { status: "FIRED" }>;

async function reconInsight(
  input: { readonly ruleId: string; readonly dedupeKey: string; readonly templateId: string; readonly observed: Observed; readonly baseline: Observed; readonly outcome: Fired; readonly trust: TrustRef },
  meta: Pick<ReconcileJobPorts, "orgId" | "runId" | "attempt" | "codeVersion" | "newId"> & { readonly createdAt: string },
): Promise<InsightOf<"DETECTION">> {
  const { outcome } = input;
  const period = { start: istDayStart(outcome.date), end: istDayStart(addDays(outcome.date, 1)) };
  const evidence = await reconEvidence(meta.orgId, outcome.ruleId, outcome.date);
  const payload: InsightOf<"DETECTION">["payload"] = {
    ruleId: input.ruleId,
    observed: input.observed,
    baseline: { method: "threshold", value: input.baseline, windowWeeks: 0 },
    // Defined, not measured: any finding is a full deviation from zero.
    deviationBps: 10_000,
    severity: RECON_SEVERITY[outcome.ruleId],
  };
  return {
    id: meta.newId(),
    orgId: meta.orgId,
    locationId: null,
    schemaVersion: 1,
    producer: RECON_PRODUCER,
    subject: { kind: "ORG", ref: "org" },
    period,
    dedupeKey: input.dedupeKey,
    evidence,
    trust: input.trust,
    copy: { templateId: input.templateId, slots: { observed: "observed" } },
    status: "ACTIVE",
    producedBy: { job: RECONCILE_JOB_NAME, runId: meta.runId, attempt: meta.attempt, codeVersion: meta.codeVersion },
    contentHash: await computeContentHash({ payload, evidence }),
    supersedes: null,
    createdAt: meta.createdAt,
    expiresAt: null,
    claimType: "DETECTION",
    payload,
  };
}

/** The DETECTIONs one fired outcome writes, with the keys they hold. */
export async function reconInsights(
  entry: { readonly outcome: Fired; readonly counts: ReconCounts },
  read: Pick<ReconRunRead, "zeroCount" | "zeroPaise" | "trustByDate">,
  meta: Pick<ReconcileJobPorts, "orgId" | "runId" | "attempt" | "codeVersion" | "newId"> & { readonly createdAt: string },
): Promise<InsightOf<"DETECTION">[]> {
  const { outcome, counts } = entry;
  const trust = reconTrust(read.trustByDate[outcome.date]);
  const [unexplainedKey, explainedKey, paiseKey] = reconKeys(outcome.ruleId, outcome.date) as [string, string, string];
  const out: InsightOf<"DETECTION">[] = [];
  if (outcome.unexplained > 0) {
    out.push(await reconInsight({ ruleId: outcome.ruleId, dedupeKey: unexplainedKey, templateId: outcome.ruleId, observed: counts.unexplained, baseline: read.zeroCount, outcome, trust }, meta));
  }
  if (outcome.explained > 0 && outcome.explainedBy) {
    out.push(
      await reconInsight(
        { ruleId: `${outcome.ruleId}.explained`, dedupeKey: explainedKey, templateId: `recon.explained.${outcome.explainedBy}`, observed: counts.explained, baseline: read.zeroCount, outcome, trust },
        meta,
      ),
    );
  }
  if (counts.amount) {
    out.push(await reconInsight({ ruleId: `${outcome.ruleId}.paise`, dedupeKey: paiseKey, templateId: `${outcome.ruleId}.paise`, observed: counts.amount, baseline: read.zeroPaise, outcome, trust }, meta));
  }
  return out;
}

export async function runReconcileNightly(ports: ReconcileJobPorts): Promise<JobRunResult> {
  if (!(await ports.factsReady(ports.date))) throw new UpstreamNotReady(ports.date);

  const now = ports.now();
  const read = await ports.readRecon(ports.date, now);
  const createdAt = istTimestamp(now);

  const insights: { insight: InsightOf<"DETECTION">; asOf: string }[] = [];
  const clears: ReconExpireRequest[] = [];
  const summary: Record<string, number> = { days: 0, fired: 0, clear: 0, not_evaluated: 0, rule_timeout: 0, facts_not_computed: 0, rows_recently_changed: 0, unexplained: 0, explained: 0 };
  const days = new Set<string>();

  for (const { outcome, counts } of read.outcomes) {
    days.add(outcome.date);
    const asOf = istDayStart(addDays(outcome.date, 1));
    if (outcome.status === "NOT_EVALUATED") {
      summary.not_evaluated! += 1;
      summary[outcome.reason] = (summary[outcome.reason] ?? 0) + 1;
      continue;
    }
    const written = outcome.status === "FIRED" && counts ? await reconInsights({ outcome, counts }, read, { ...ports, createdAt }) : [];
    const heldKeys = new Set(written.map((insight) => insight.dedupeKey));
    for (const insight of written) insights.push({ insight, asOf });
    for (const key of reconKeys(outcome.ruleId, outcome.date)) if (!heldKeys.has(key)) clears.push({ dedupeKey: key, asOf, reason: "CLEARED" });

    if (outcome.status === "CLEAR") summary.clear! += 1;
    else {
      summary.fired! += 1;
      summary.unexplained! += outcome.unexplained;
      summary.explained! += outcome.explained;
      const rule = outcome.ruleId.replace("recon.", "");
      summary[`unexplained_${rule}`] = (summary[`unexplained_${rule}`] ?? 0) + outcome.unexplained;
    }
  }
  summary.days = days.size;
  summary.rules = RECON_RULE_IDS.length;

  const { writes, expired } = await ports.commit(async (writer) => {
    const results: string[] = [];
    for (const { insight, asOf } of insights) results.push((await writer.writeInsight(insight, { asOf })).outcome);
    const expiredResult = clears.length > 0 ? await writer.expireInsights(clears) : { expired: 0 };
    return { writes: results, expired: expiredResult.expired };
  });

  for (const outcome of writes) summary[`insight_${outcome.toLowerCase()}`] = (summary[`insight_${outcome.toLowerCase()}`] ?? 0) + 1;
  summary.insights_expired = expired;
  const rowsWritten = writes.filter((o) => o !== "NOOP").length + expired;

  // A rule whose read does not finish is never evaluated and its keys are
  // never expired, so its findings freeze as ACTIVE and no clear ever lands.
  // Nothing above the summary would notice, and the state survives every
  // retry, so the run must report PARTIAL: RULE_TIMEOUT always counts as a
  // failure, the run exhausts and systemd's OnFailure fires (RELIABILITY #2,
  // iq2-adapt part 1). The findings this run did write are already committed.
  if (summary.rule_timeout! > 0) return { status: "PARTIAL", reason: "RULE_TIMEOUT", rowsWritten, summary };
  return { status: "COMPLETE", rowsWritten, summary };
}

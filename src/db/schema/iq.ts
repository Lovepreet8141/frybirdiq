/**
 * The intelligence engine's storage. hive reviews/iq-0 DESIGN.md §2 and
 * DESIGN-v2-DELTA.md §2; migration 0034.
 *
 * Seven tables, all server-written through Drizzle as `postgres`:
 *
 * - iq_job_runs        one claimed run of one job for one org and period
 * - iq_insights        a typed claim (FACT … AUTOMATION); frozen once referenced
 * - iq_forecasts       the p10/p50/p90 numbers behind a FORECAST
 * - iq_recommendations a proposed action, with an impact range and an expiry
 * - iq_actions         an action's life: approval, execution, undo
 * - iq_outcomes        what actually happened against what was expected
 * - iq_auto_policies   the owner's switch for running an A1 kind automatically
 *
 * Vocabularies are text + CHECK, never pg enums (DESIGN D1): the lists mirror
 * `src/lib/iq/engine` and `src/lib/iq/automation`, and `iq.test.ts` fails when
 * they drift apart. Staff read three tables through RLS (OWNER, ADMIN,
 * MANAGER); the other four have RLS on and no policy. Nobody but `postgres`
 * writes any of them — the grants in 0034 say so.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { auditLogs } from "./platform";
import { locations, organizations } from "./tenancy";

export const IQ_JOB_RUN_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] as const;
export const IQ_JOB_TRIGGERS = ["TIMER", "MANUAL", "CATCHUP"] as const;
export const IQ_CLAIM_TYPES = ["FACT", "DETECTION", "FORECAST", "EXPLANATION", "RECOMMENDATION", "AUTOMATION"] as const;
export const IQ_INSIGHT_STATUSES = ["ACTIVE", "SUPERSEDED", "EXPIRED", "RETRACTED"] as const;
export const IQ_SUBJECT_KINDS = [
  "ORG",
  "LOCATION",
  "PRODUCT",
  "MODIFIER",
  "INGREDIENT",
  "RECIPE",
  "SUPPLIER",
  "CHANNEL",
  "DAYPART",
  "METRIC",
  "JOB",
] as const;
export const IQ_TRUST_STATES = ["MEASURED", "NOT_MEASURED", "INSUFFICIENT_DATA"] as const;
export const IQ_UNITS = ["paise", "count", "bps", "grams", "ml", "pieces", "seconds"] as const;
export const IQ_FORECAST_TARGETS = ["ITEM", "INGREDIENT", "ORDERS", "REVENUE"] as const;
export const IQ_BACKTEST_METRICS = ["WAPE", "MAE"] as const;
export const IQ_BACKTEST_PROVENANCES = ["LOCAL_SYNTHETIC", "APPROVED_EXPORT", "PRODUCTION_JOB"] as const;
export const IQ_TIERS = ["A0", "A1", "A2", "A3"] as const;
export const IQ_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const IQ_RECOMMENDATION_STATUSES = ["PROPOSED", "APPROVED", "DISMISSED", "EXPIRED", "SUPERSEDED"] as const;
export const IQ_ACTION_STATUSES = [
  "QUEUED",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "CANCELLED",
  "UNDONE",
  "HANDOFF",
] as const;
/** automation/state-machine.ts OPEN_ACTION_STATUSES: at most one such row per org, kind and params hash. */
export const IQ_OPEN_ACTION_STATUSES = ["QUEUED", "PENDING_APPROVAL", "APPROVED", "EXECUTING", "HANDOFF"] as const;
/**
 * The statuses a row may hold, by how it runs. Mode is not stored: like
 * `modeOf` in state-machine.ts it follows from the tier and whether an auto
 * policy is recorded (A0 and A1-with-policy AUTO; A1-without and A2 APPROVAL;
 * A3 HANDOFF). iq.test.ts ties each list to the transitions reachable in code.
 */
export const IQ_MODE_STATUSES = {
  AUTO: ["QUEUED", "EXECUTING", "SUCCEEDED", "FAILED", "CANCELLED", "UNDONE"],
  APPROVAL: ["PENDING_APPROVAL", "APPROVED", "EXECUTING", "SUCCEEDED", "FAILED", "REJECTED", "EXPIRED", "SUPERSEDED", "CANCELLED", "UNDONE"],
  HANDOFF: ["HANDOFF", "CANCELLED", "EXPIRED", "SUPERSEDED"],
} as const;
export const IQ_UNDO_KINDS = ["NONE", "REVERT", "COMPENSATING"] as const;
export const IQ_OUTCOME_SUBJECTS = ["ACTION", "RECOMMENDATION", "FORECAST"] as const;
export const IQ_OUTCOME_VERDICTS = ["WITHIN", "BETTER", "WORSE", "INCONCLUSIVE", "DATA_MISSING"] as const;

/**
 * Every action kind the database lets run below A3, with its tier.
 *
 * Deny by default: a kind missing here can only be stored as A3 (handed to a
 * person, never executed). So a money kind cannot reach an executor through a
 * mistyped tier, and a new executable kind needs a migration — a reviewed
 * change, which a new automatic action class should be anyway.
 */
export const IQ_EXECUTABLE_KINDS = {
  "brief.publish": "A0",
  "detection.publish": "A0",
  "forecast.publish": "A0",
  "reconciliation.report": "A0",
  "purchase_order.create_draft": "A1",
  "inventory.flag_recount": "A1",
  "prep_list.prefill": "A1",
  "task.open_internal": "A1",
  "menu.mark_86": "A2",
  "customer.winback_message": "A2",
} as const satisfies Record<string, (typeof IQ_TIERS)[number]>;

/** `'A', 'B'` — for a CHECK. Values are this file's own constants, never input. */
const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

const executableKindPairs = sql.raw(
  Object.entries(IQ_EXECUTABLE_KINDS)
    .map(([kind, tier]) => `('${kind}', '${tier}')`)
    .join(", "),
);

const a1Kinds = Object.entries(IQ_EXECUTABLE_KINDS)
  .filter(([, tier]) => tier === "A1")
  .map(([kind]) => kind);

const SHA256 = sql.raw(`'^[0-9a-f]{64}$'`);

export const iqJobRuns = pgTable(
  "iq_job_runs",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    job: text("job").notNull(),
    /** IST period the run covers, e.g. `2026-09-17` or `2026-09-17T10`. */
    periodKey: text("period_key").notNull(),
    status: text("status").notNull().default("RUNNING"),
    trigger: text("trigger").notNull(),
    attempt: integer("attempt").notNull().default(1),
    /** Minted by the claimant; every output write checks it (fencing). */
    leaseOwner: uuid("lease_owner").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    /** Where a run stopped at its deadline; the next attempt resumes from it (jobs/handle.ts). */
    cursor: text("cursor"),
    rowsWritten: integer("rows_written").notNull().default(0),
    /** Counts only. */
    summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
    errorCode: text("error_code"),
    /** Scrubbed; never a connection string, never personal data. */
    errorMessage: text("error_message"),
    codeVersion: text("code_version").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("iq_job_runs_job_org_period_unique").on(table.job, table.orgId, table.periodKey),
    index("iq_job_runs_org_job_started_idx").on(table.orgId, table.job, table.startedAt.desc()),
    index("iq_job_runs_open_lease_idx")
      .on(table.status, table.leaseExpiresAt)
      .where(sql`${table.status} IN ('RUNNING', 'FAILED')`),
    check("iq_job_runs_status_check", sql`${table.status} IN (${list(IQ_JOB_RUN_STATUSES)})`),
    check("iq_job_runs_trigger_check", sql`${table.trigger} IN (${list(IQ_JOB_TRIGGERS)})`),
    check("iq_job_runs_attempt_check", sql`${table.attempt} >= 1`),
    check("iq_job_runs_counts_check", sql`${table.rowsWritten} >= 0 AND (${table.durationMs} IS NULL OR ${table.durationMs} >= 0)`),
    check("iq_job_runs_summary_check", sql`jsonb_typeof(${table.summary}) = 'object'`),
    check("iq_job_runs_error_message_check", sql`char_length(${table.errorMessage}) <= 500`),
  ],
);

export const iqInsights = pgTable(
  "iq_insights",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    claimType: text("claim_type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    producer: text("producer").notNull(),
    subjectKind: text("subject_kind").notNull(),
    subjectRef: text("subject_ref").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    severity: smallint("severity"),
    status: text("status").notNull().default("ACTIVE"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    evidence: jsonb("evidence").$type<unknown[]>().notNull(),
    trustState: text("trust_state").notNull().default("NOT_MEASURED"),
    trustScore: integer("trust_score"),
    trustAsOf: timestamp("trust_as_of", { withTimezone: true }),
    jobRunId: uuid("job_run_id").references(() => iqJobRuns.id, { onDelete: "set null" }),
    jobAttempt: integer("job_attempt"),
    codeVersion: text("code_version").notNull(),
    /** sha256 of the canonical JSON of payload + evidence (engine content-hash.ts). */
    contentHash: text("content_hash").notNull(),
    supersedes: uuid("supersedes"),
    /** DEFERRABLE INITIALLY DEFERRED in 0034 (hand-edited; drizzle cannot declare it). */
    supersededBy: uuid("superseded_by"),
    /** Set by the database when a recommendation first cites this row; from then on its content is frozen. */
    referencedAt: timestamp("referenced_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // Target of the org-matched foreign keys below: a row can only cite an insight of its own org.
    unique("iq_insights_id_org_unique").on(table.id, table.orgId),
    uniqueIndex("iq_insights_active_dedupe_unique")
      .on(table.orgId, table.dedupeKey)
      .where(sql`${table.status} = 'ACTIVE'`),
    index("iq_insights_org_claim_created_idx").on(table.orgId, table.claimType, table.createdAt.desc()),
    index("iq_insights_org_subject_idx").on(table.orgId, table.subjectKind, table.subjectRef),
    index("iq_insights_job_run_idx").on(table.jobRunId),
    foreignKey({ name: "iq_insights_supersedes_fk", columns: [table.supersedes], foreignColumns: [table.id] }).onDelete("set null"),
    foreignKey({ name: "iq_insights_superseded_by_fk", columns: [table.supersededBy], foreignColumns: [table.id] }).onDelete("set null"),
    check("iq_insights_claim_type_check", sql`${table.claimType} IN (${list(IQ_CLAIM_TYPES)})`),
    check("iq_insights_status_check", sql`${table.status} IN (${list(IQ_INSIGHT_STATUSES)})`),
    check("iq_insights_subject_kind_check", sql`${table.subjectKind} IN (${list(IQ_SUBJECT_KINDS)})`),
    check("iq_insights_trust_state_check", sql`${table.trustState} IN (${list(IQ_TRUST_STATES)})`),
    check(
      "iq_insights_trust_score_check",
      sql`(${table.trustState} = 'MEASURED') = (${table.trustScore} IS NOT NULL AND ${table.trustAsOf} IS NOT NULL) AND (${table.trustScore} IS NULL OR ${table.trustScore} BETWEEN 0 AND 100)`,
    ),
    check("iq_insights_schema_version_check", sql`${table.schemaVersion} >= 1`),
    check("iq_insights_severity_check", sql`${table.severity} IS NULL OR ${table.severity} BETWEEN 1 AND 3`),
    check("iq_insights_period_check", sql`${table.periodEnd} >= ${table.periodStart}`),
    check("iq_insights_content_hash_check", sql`${table.contentHash} ~ ${SHA256}`),
    check("iq_insights_payload_object_check", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check("iq_insights_evidence_check", sql`jsonb_typeof(${table.evidence}) = 'array' AND jsonb_array_length(${table.evidence}) >= 1`),
    // DESIGN §1.4 (5): an estimate never carries a bare `value`.
    check(
      "iq_insights_no_bare_value_check",
      sql`${table.claimType} IN ('FACT', 'DETECTION') OR NOT (${table.payload} ? 'value')`,
    ),
    check("iq_insights_forecast_interval_check", sql`${table.claimType} <> 'FORECAST' OR ${table.payload} ? 'interval'`),
    check("iq_insights_recommendation_expiry_check", sql`${table.claimType} <> 'RECOMMENDATION' OR ${table.expiresAt} IS NOT NULL`),
    check(
      "iq_insights_supersede_check",
      sql`(${table.supersedes} IS NULL OR ${table.supersedes} <> ${table.id}) AND (${table.supersededBy} IS NULL OR (${table.supersededBy} <> ${table.id} AND ${table.status} = 'SUPERSEDED'))`,
    ),
  ],
);

export const iqForecasts = pgTable(
  "iq_forecasts",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    insightId: uuid("insight_id").references(() => iqInsights.id, { onDelete: "set null" }),
    targetKind: text("target_kind").notNull(),
    targetRef: text("target_ref").notNull(),
    businessDate: date("business_date").notNull(),
    daypart: text("daypart").notNull().default("ALL"),
    unit: text("unit").notNull(),
    /** Integer base units of `unit`; paise when the unit is money. */
    p10: bigint("p10", { mode: "bigint" }).notNull(),
    p50: bigint("p50", { mode: "bigint" }).notNull(),
    p90: bigint("p90", { mode: "bigint" }).notNull(),
    modelId: text("model_id").notNull(),
    modelVersion: text("model_version").notNull(),
    isNaiveFallback: boolean("is_naive_fallback").notNull().default(false),
    /** The IST business date the forecast was issued on. */
    issuedFor: date("issued_for").notNull(),
    horizonDays: integer("horizon_days").notNull(),
    backtestMetric: text("backtest_metric").notNull(),
    modelErrorBps: integer("model_error_bps").notNull(),
    naiveErrorBps: integer("naive_error_bps").notNull(),
    backtestWindowDays: integer("backtest_window_days").notNull(),
    backtestProvenance: text("backtest_provenance").notNull(),
    jobRunId: uuid("job_run_id").references(() => iqJobRuns.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    // NULLS NOT DISTINCT needs Postgres >= 15: an org-wide forecast (location_id null) is still one row.
    unique("iq_forecasts_target_unique")
      .on(
        table.orgId,
        table.locationId,
        table.targetKind,
        table.targetRef,
        table.businessDate,
        table.daypart,
        table.modelId,
        table.modelVersion,
        table.issuedFor,
      )
      .nullsNotDistinct(),
    index("iq_forecasts_insight_idx").on(table.insightId),
    index("iq_forecasts_job_run_idx").on(table.jobRunId),
    check("iq_forecasts_target_kind_check", sql`${table.targetKind} IN (${list(IQ_FORECAST_TARGETS)})`),
    check("iq_forecasts_unit_check", sql`${table.unit} IN (${list(IQ_UNITS)})`),
    check("iq_forecasts_interval_check", sql`0 <= ${table.p10} AND ${table.p10} <= ${table.p50} AND ${table.p50} <= ${table.p90}`),
    check("iq_forecasts_horizon_check", sql`${table.horizonDays} >= 0`),
    check("iq_forecasts_backtest_metric_check", sql`${table.backtestMetric} IN (${list(IQ_BACKTEST_METRICS)})`),
    check("iq_forecasts_backtest_provenance_check", sql`${table.backtestProvenance} IN (${list(IQ_BACKTEST_PROVENANCES)})`),
    check(
      "iq_forecasts_backtest_numbers_check",
      sql`${table.modelErrorBps} >= 0 AND ${table.naiveErrorBps} >= 0 AND ${table.backtestWindowDays} >= 1`,
    ),
  ],
);

export const iqRecommendations = pgTable(
  "iq_recommendations",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    /** The RECOMMENDATION insight. Inserting this row freezes it (trigger in 0034). */
    insightId: uuid("insight_id").notNull(),
    actionKind: text("action_kind").notNull(),
    tier: text("tier").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    paramsHash: text("params_hash").notNull(),
    impactUnit: text("impact_unit").notNull(),
    impactLow: bigint("impact_low", { mode: "bigint" }).notNull(),
    impactHigh: bigint("impact_high", { mode: "bigint" }).notNull(),
    confidence: text("confidence").notNull(),
    assumptions: jsonb("assumptions").$type<unknown[]>().notNull(),
    status: text("status").notNull().default("PROPOSED"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedByUserId: uuid("decided_by_user_id"),
    /** When the row left PROPOSED; the dismissal/expiry cooldown reads it. */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    dedupeKey: text("dedupe_key").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("iq_recommendations_insight_unique").on(table.insightId),
    unique("iq_recommendations_id_org_unique").on(table.id, table.orgId),
    // NO ACTION, not RESTRICT: a direct delete of a cited insight still fails, but an org delete can cascade through both.
    foreignKey({
      name: "iq_recommendations_insight_fk",
      columns: [table.insightId, table.orgId],
      foreignColumns: [iqInsights.id, iqInsights.orgId],
    }),
    uniqueIndex("iq_recommendations_proposed_dedupe_unique")
      .on(table.orgId, table.dedupeKey)
      .where(sql`${table.status} = 'PROPOSED'`),
    index("iq_recommendations_cooldown_idx").on(table.orgId, table.actionKind, table.paramsHash, table.decidedAt.desc()),
    check("iq_recommendations_tier_check", sql`${table.tier} IN (${list(IQ_TIERS)})`),
    check(
      "iq_recommendations_kind_tier_check",
      sql`${table.tier} = 'A3' OR (${table.actionKind}, ${table.tier}) IN (${executableKindPairs})`,
    ),
    check("iq_recommendations_params_hash_check", sql`${table.paramsHash} ~ ${SHA256}`),
    check("iq_recommendations_params_object_check", sql`jsonb_typeof(${table.params}) = 'object'`),
    check("iq_recommendations_impact_unit_check", sql`${table.impactUnit} IN (${list(IQ_UNITS)})`),
    check("iq_recommendations_impact_range_check", sql`${table.impactLow} <= ${table.impactHigh}`),
    check("iq_recommendations_confidence_check", sql`${table.confidence} IN (${list(IQ_CONFIDENCE_LEVELS)})`),
    check(
      "iq_recommendations_assumptions_check",
      sql`jsonb_typeof(${table.assumptions}) = 'array' AND jsonb_array_length(${table.assumptions}) >= 1`,
    ),
    check("iq_recommendations_status_check", sql`${table.status} IN (${list(IQ_RECOMMENDATION_STATUSES)})`),
    check("iq_recommendations_decided_check", sql`(${table.status} = 'PROPOSED') = (${table.decidedAt} IS NULL)`),
    check(
      "iq_recommendations_decided_by_check",
      sql`${table.status} NOT IN ('APPROVED', 'DISMISSED') OR ${table.decidedByUserId} IS NOT NULL`,
    ),
    check("iq_recommendations_reason_check", sql`char_length(${table.decisionReason}) <= 500`),
  ],
);

export const iqAutoPolicies = pgTable(
  "iq_auto_policies",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actionKind: text("action_kind").notNull(),
    /** null covers every location of the org. */
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** Exactly `{ "maxPerDay": 1..50 }` — AutoPolicyLimitsSchema. */
    limits: jsonb("limits").$type<{ maxPerDay: number }>().notNull(),
    /** Compare-and-set on every change. */
    version: integer("version").notNull().default(1),
    setBy: uuid("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason").notNull(),
    auditLogId: uuid("audit_log_id").references(() => auditLogs.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    unique("iq_auto_policies_scope_unique").on(table.orgId, table.actionKind, table.locationId).nullsNotDistinct(),
    unique("iq_auto_policies_id_org_unique").on(table.id, table.orgId),
    check("iq_auto_policies_kind_check", sql`${table.actionKind} IN (${list(a1Kinds)})`),
    check("iq_auto_policies_version_check", sql`${table.version} >= 1`),
    check(
      "iq_auto_policies_limits_check",
      sql`CASE WHEN jsonb_typeof(${table.limits}) = 'object'
            AND (${table.limits} - 'maxPerDay') = '{}'::jsonb
            AND jsonb_typeof(${table.limits} -> 'maxPerDay') = 'number'
          THEN (${table.limits} ->> 'maxPerDay')::numeric BETWEEN 1 AND 50
            AND (${table.limits} ->> 'maxPerDay')::numeric = trunc((${table.limits} ->> 'maxPerDay')::numeric)
          ELSE false END`,
    ),
    check("iq_auto_policies_reason_check", sql`char_length(${table.reason}) BETWEEN 1 AND 500`),
  ],
);

/** SQL for "this row runs in AUTO / APPROVAL / HANDOFF mode" — state-machine.ts `modeOf`, over stored columns. */
const modeIs = {
  AUTO: (t: { tier: unknown; autoPolicyId: unknown }) => sql`(${t.tier} = 'A0' OR (${t.tier} = 'A1' AND ${t.autoPolicyId} IS NOT NULL))`,
  APPROVAL: (t: { tier: unknown; autoPolicyId: unknown }) => sql`(${t.tier} = 'A2' OR (${t.tier} = 'A1' AND ${t.autoPolicyId} IS NULL))`,
  HANDOFF: (t: { tier: unknown }) => sql`${t.tier} = 'A3'`,
};

/** Statuses past approval on the execute path; an APPROVAL-mode row in one of these was approved by a person. */
const APPROVED_PATH = ["APPROVED", "EXECUTING", "SUCCEEDED", "FAILED", "UNDONE"] as const;

export const iqActions = pgTable(
  "iq_actions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    recommendationId: uuid("recommendation_id"),
    actionKind: text("action_kind").notNull(),
    tier: text("tier").notNull(),
    status: text("status").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    paramsHash: text("params_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Who or what created the row, e.g. a job name or `staff`. */
    origin: text("origin").notNull(),
    requestedBy: uuid("requested_by"),
    /** Set only on an A1 row created under a policy; that is what makes it AUTO. */
    autoPolicyId: uuid("auto_policy_id"),
    autoPolicyVersion: integer("auto_policy_version"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** When a PENDING_APPROVAL or HANDOFF row lapses. */
    approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true }),
    /** An APPROVED row not started by then expires instead of running on stale params. */
    executeBy: timestamp("execute_by", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    /** Database time the row entered a closed status (trigger); the cooldown reads it. */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Database time the row entered EXECUTING (trigger); the stale-execution sweep reads it. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    attempt: integer("attempt").notNull().default(0),
    targetEntity: text("target_entity"),
    targetId: text("target_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    undoKind: text("undo_kind").notNull().default("NONE"),
    undoParams: jsonb("undo_params").$type<Record<string, unknown>>(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    auditLogId: uuid("audit_log_id").references(() => auditLogs.id, { onDelete: "set null" }),
    jobRunId: uuid("job_run_id").references(() => iqJobRuns.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    unique("iq_actions_idempotency_unique").on(table.orgId, table.idempotencyKey),
    foreignKey({
      name: "iq_actions_recommendation_fk",
      columns: [table.recommendationId, table.orgId],
      foreignColumns: [iqRecommendations.id, iqRecommendations.orgId],
    }),
    foreignKey({
      name: "iq_actions_auto_policy_fk",
      columns: [table.autoPolicyId, table.orgId],
      foreignColumns: [iqAutoPolicies.id, iqAutoPolicies.orgId],
    }),
    // Two runs proposing the same thing cannot both insert; the loser treats 23505 as a no-op.
    uniqueIndex("iq_actions_open_params_unique")
      .on(table.orgId, table.actionKind, table.paramsHash)
      .where(sql`${table.status} IN (${list(IQ_OPEN_ACTION_STATUSES)})`),
    index("iq_actions_cooldown_idx").on(table.orgId, table.actionKind, table.paramsHash, table.decidedAt.desc()),
    index("iq_actions_org_status_created_idx").on(table.orgId, table.status, table.createdAt.desc()),
    index("iq_actions_pending_idx")
      .on(table.orgId, table.approvalExpiresAt)
      .where(sql`${table.status} IN ('PENDING_APPROVAL', 'HANDOFF')`),
    index("iq_actions_approved_idx")
      .on(table.orgId, table.executeBy)
      .where(sql`${table.status} = 'APPROVED'`),
    index("iq_actions_executing_idx")
      .on(table.startedAt)
      .where(sql`${table.status} = 'EXECUTING'`),
    // Counts today's automatic executions of a kind while the policy row is locked.
    index("iq_actions_auto_usage_idx")
      .on(table.orgId, table.actionKind, table.locationId, table.createdAt)
      .where(sql`${table.autoPolicyId} IS NOT NULL`),
    index("iq_actions_recommendation_idx").on(table.recommendationId),
    check("iq_actions_tier_check", sql`${table.tier} IN (${list(IQ_TIERS)})`),
    check("iq_actions_status_check", sql`${table.status} IN (${list(IQ_ACTION_STATUSES)})`),
    check("iq_actions_kind_tier_check", sql`${table.tier} = 'A3' OR (${table.actionKind}, ${table.tier}) IN (${executableKindPairs})`),
    // modeOf returns null (ROW_INCONSISTENT) for a policy on anything but A1: never store one.
    check(
      "iq_actions_auto_policy_check",
      sql`(${table.autoPolicyId} IS NULL) = (${table.autoPolicyVersion} IS NULL)
          AND (${table.autoPolicyId} IS NULL OR ${table.tier} = 'A1')`,
    ),
    check(
      "iq_actions_mode_status_check",
      sql`(${modeIs.AUTO(table)} AND ${table.status} IN (${list(IQ_MODE_STATUSES.AUTO)}))
          OR (${modeIs.APPROVAL(table)} AND ${table.status} IN (${list(IQ_MODE_STATUSES.APPROVAL)}))
          OR (${modeIs.HANDOFF(table)} AND ${table.status} IN (${list(IQ_MODE_STATUSES.HANDOFF)}))`,
    ),
    // Approved by a person XOR run under a policy; A0 and A3 carry no approval.
    check(
      "iq_actions_approved_by_check",
      sql`CASE WHEN ${modeIs.APPROVAL(table)} AND ${table.status} IN (${list(APPROVED_PATH)})
            THEN ${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL
          WHEN ${modeIs.APPROVAL(table)} THEN true
          ELSE ${table.approvedBy} IS NULL AND ${table.approvedAt} IS NULL END`,
    ),
    check("iq_actions_approval_expiry_check", sql`NOT (${modeIs.APPROVAL(table)} OR ${modeIs.HANDOFF(table)}) OR ${table.approvalExpiresAt} IS NOT NULL`),
    check("iq_actions_execute_by_check", sql`${table.status} <> 'APPROVED' OR ${table.executeBy} IS NOT NULL`),
    check("iq_actions_started_check", sql`${table.status} <> 'EXECUTING' OR ${table.startedAt} IS NOT NULL`),
    check(
      "iq_actions_decided_check",
      sql`(${table.status} IN (${list(IQ_OPEN_ACTION_STATUSES)})) = (${table.decidedAt} IS NULL)`,
    ),
    check("iq_actions_params_hash_check", sql`${table.paramsHash} ~ ${SHA256}`),
    check("iq_actions_attempt_check", sql`${table.attempt} >= 0`),
    check("iq_actions_undo_kind_check", sql`${table.undoKind} IN (${list(IQ_UNDO_KINDS)})`),
    check("iq_actions_undone_check", sql`(${table.status} = 'UNDONE') = (${table.undoneAt} IS NOT NULL)`),
    check("iq_actions_error_message_check", sql`char_length(${table.errorMessage}) <= 500`),
  ],
);

export const iqOutcomes = pgTable(
  "iq_outcomes",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind").notNull(),
    /** An iq_actions, iq_recommendations or iq_forecasts id, per subject_kind; no FK (polymorphic). */
    subjectId: uuid("subject_id").notNull(),
    metricId: text("metric_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    unit: text("unit").notNull(),
    expectedLow: bigint("expected_low", { mode: "bigint" }).notNull(),
    expectedHigh: bigint("expected_high", { mode: "bigint" }).notNull(),
    actual: bigint("actual", { mode: "bigint" }),
    verdict: text("verdict").notNull(),
    trustScoreAtMeasure: integer("trust_score_at_measure"),
    jobRunId: uuid("job_run_id").references(() => iqJobRuns.id, { onDelete: "set null" }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("iq_outcomes_window_unique").on(table.orgId, table.subjectKind, table.subjectId, table.metricId, table.windowEnd),
    index("iq_outcomes_job_run_idx").on(table.jobRunId),
    check("iq_outcomes_subject_kind_check", sql`${table.subjectKind} IN (${list(IQ_OUTCOME_SUBJECTS)})`),
    check("iq_outcomes_unit_check", sql`${table.unit} IN (${list(IQ_UNITS)})`),
    check("iq_outcomes_verdict_check", sql`${table.verdict} IN (${list(IQ_OUTCOME_VERDICTS)})`),
    check("iq_outcomes_window_check", sql`${table.windowEnd} >= ${table.windowStart}`),
    check("iq_outcomes_expected_check", sql`${table.expectedLow} <= ${table.expectedHigh}`),
    check("iq_outcomes_actual_check", sql`(${table.verdict} = 'DATA_MISSING') = (${table.actual} IS NULL)`),
    check(
      "iq_outcomes_trust_score_check",
      sql`${table.trustScoreAtMeasure} IS NULL OR ${table.trustScoreAtMeasure} BETWEEN 0 AND 100`,
    ),
  ],
);

/**
 * IQ-1 facts: additive metric values per IST business day (and per 15-minute
 * bucket for today), and the trust signals scored beside them. hive
 * reviews/iq-1 DESIGN.md "Tables" with REVIEW.md B1–B7; migration 0036.
 *
 * Written only by the fact jobs through Drizzle as `postgres`, one
 * `recomputeDay` transaction at a time: delete + insert for (org, date,
 * version) under an advisory lock (B2), so there is no upsert and no
 * `updated_at`. Ratios are never stored — they are Σ÷Σ at read time.
 *
 * Metric, dimension and signal ids live in `src/lib/iq/metrics/catalog.ts`.
 * The CHECKs here constrain their shape, not the list, so a new metric or a
 * new definition version needs no migration; `iq-facts.test.ts` keeps the
 * shapes and the unit and grade vocabularies in step with the catalog.
 *
 * Reads through a Supabase key are OWNER and MANAGER only — the roles holding
 * `finance.view` in src/domain/permissions.ts, because these rows are revenue,
 * food cost and expenses. Nobody but `postgres` writes them.
 */

import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { iqJobRuns } from "./iq";
import { locations, organizations } from "./tenancy";

export const IQ_FACT_UNITS = ["paise", "count"] as const;
export const IQ_TRUST_GRADES = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

/** `metric_id`, `signal_id` and a non-empty `dimension_key`: lower-case catalog identifiers. */
export const IQ_FACT_ID_PATTERN = "^[a-z][a-z0-9_]{0,63}$";

/** `'A', 'B'` — for a CHECK. Values are this file's own constants, never input. */
const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const ID_PATTERN = sql.raw(`'${IQ_FACT_ID_PATTERN}'`);

/** Columns shared by the daily and intraday fact tables. */
const factColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** null = the whole org (expenses and targets are org-level). */
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
  /** IST business day (src/lib/dates). */
  businessDate: date("business_date").notNull(),
  metricId: text("metric_id").notNull(),
  /** '' and '' for the undimensioned total. */
  dimensionKey: text("dimension_key").notNull().default(""),
  dimensionValue: text("dimension_value").notNull().default(""),
  unit: text("unit").notNull(),
  /** Integer base units of `unit`; paise for money. May be negative (refunds, fee residual). */
  value: bigint("value", { mode: "bigint" }).notNull(),
  sourceRowCount: integer("source_row_count").notNull().default(0),
  /** The newest source change the value reflects; a newer one marks the day for recompute. */
  sourceWatermark: timestamp("source_watermark", { withTimezone: true }),
  definitionVersion: integer("definition_version").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  jobRunId: uuid("job_run_id").references(() => iqJobRuns.id, { onDelete: "set null" }),
});

type FactTable = {
  metricId: unknown;
  dimensionKey: unknown;
  dimensionValue: unknown;
  unit: unknown;
  sourceRowCount: unknown;
  definitionVersion: unknown;
};

const factChecks = (prefix: string, t: FactTable) => [
  check(`${prefix}_metric_id_check`, sql`${t.metricId} ~ ${ID_PATTERN}`),
  check(
    `${prefix}_dimension_check`,
    sql`(${t.dimensionKey} = '' AND ${t.dimensionValue} = '')
        OR (${t.dimensionKey} ~ ${ID_PATTERN} AND char_length(${t.dimensionValue}) BETWEEN 1 AND 200)`,
  ),
  check(`${prefix}_unit_check`, sql`${t.unit} IN (${list(IQ_FACT_UNITS)})`),
  check(`${prefix}_source_row_count_check`, sql`${t.sourceRowCount} >= 0`),
  check(`${prefix}_definition_version_check`, sql`${t.definitionVersion} >= 1`),
];

export const iqDailyFacts = pgTable(
  "iq_daily_facts",
  factColumns(),
  (table) => [
    // NULLS NOT DISTINCT (Postgres >= 15): one org-wide row per key, location null included (B1).
    unique("iq_daily_facts_key_unique")
      .on(
        table.orgId,
        table.locationId,
        table.businessDate,
        table.metricId,
        table.dimensionKey,
        table.dimensionValue,
        table.definitionVersion,
      )
      .nullsNotDistinct(),
    index("iq_daily_facts_org_date_idx").on(table.orgId, table.businessDate),
    index("iq_daily_facts_org_metric_date_idx").on(table.orgId, table.metricId, table.businessDate),
    index("iq_daily_facts_job_run_idx").on(table.jobRunId),
    ...factChecks("iq_daily_facts", table),
  ],
);

export const iqIntradayFacts = pgTable(
  "iq_intraday_facts",
  {
    ...factColumns(),
    /** Start of the 15-minute bucket; the row holds that bucket's increment. Kept 35 days (B7). */
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("iq_intraday_facts_key_unique")
      .on(
        table.orgId,
        table.locationId,
        table.bucketStart,
        table.metricId,
        table.dimensionKey,
        table.dimensionValue,
        table.definitionVersion,
      )
      .nullsNotDistinct(),
    index("iq_intraday_facts_org_date_idx").on(table.orgId, table.businessDate),
    index("iq_intraday_facts_org_metric_bucket_idx").on(table.orgId, table.metricId, table.bucketStart),
    index("iq_intraday_facts_job_run_idx").on(table.jobRunId),
    ...factChecks("iq_intraday_facts", table),
    // IST is UTC+05:30, so IST quarter-hours are UTC quarter-hours.
    check("iq_intraday_facts_bucket_check", sql`extract(epoch FROM ${table.bucketStart})::bigint % 900 = 0`),
    check(
      "iq_intraday_facts_bucket_day_check",
      sql`(${table.bucketStart} AT TIME ZONE 'Asia/Kolkata')::date = ${table.businessDate}`,
    ),
  ],
);

export const iqDailyTrust = pgTable(
  "iq_daily_trust",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    businessDate: date("business_date").notNull(),
    signalId: text("signal_id").notNull(),
    numerator: bigint("numerator", { mode: "bigint" }).notNull().default(sql`0`),
    denominator: bigint("denominator", { mode: "bigint" }).notNull().default(sql`0`),
    grade: text("grade").notNull(),
    /** Counts only: a flat object of numbers, never names, phones or ids. */
    detail: jsonb("detail").$type<Record<string, number>>().notNull().default({}),
    definitionVersion: integer("definition_version").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    jobRunId: uuid("job_run_id").references(() => iqJobRuns.id, { onDelete: "set null" }),
  },
  (table) => [
    unique("iq_daily_trust_key_unique")
      .on(table.orgId, table.locationId, table.businessDate, table.signalId, table.definitionVersion)
      .nullsNotDistinct(),
    index("iq_daily_trust_org_date_idx").on(table.orgId, table.businessDate),
    index("iq_daily_trust_job_run_idx").on(table.jobRunId),
    check("iq_daily_trust_signal_id_check", sql`${table.signalId} ~ ${ID_PATTERN}`),
    check("iq_daily_trust_grade_check", sql`${table.grade} IN (${list(IQ_TRUST_GRADES)})`),
    check("iq_daily_trust_counts_check", sql`${table.numerator} >= 0 AND ${table.denominator} >= 0`),
    check(
      "iq_daily_trust_detail_check",
      sql`jsonb_typeof(${table.detail}) = 'object' AND NOT jsonb_path_exists(${table.detail}, '$.* ? (@.type() != "number")')`,
    ),
    check("iq_daily_trust_definition_version_check", sql`${table.definitionVersion} >= 1`),
  ],
);

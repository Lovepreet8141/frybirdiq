/**
 * The six claim payloads.
 *
 * DESIGN.md §1.3 as amended by DESIGN-v2-DELTA.md §1. Every schema is strict,
 * so a key the contract does not name is a parse error, not a silent extra.
 *
 * The shapes are what keep a prediction from passing as a fact:
 * - only FACT has a `value`, and it is Observed;
 * - FORECAST carries an interval and RECOMMENDATION a range — neither has a
 *   point figure to render bare;
 * - Observed and Estimated are different brands, so a model output cannot
 *   be placed where a stored reading belongs.
 */
import { z } from "zod";

import { CodeSchema, IdentifierSchema, IstDateTimeSchema } from "./evidence";
import {
  EstimatedSchema,
  IntervalSchema,
  ObservedSchema,
  RangeSchema,
  magnitudeOf,
  sameUnit,
  sumMagnitudes,
} from "./quantity";
import { ConfidenceSchema } from "./trust";

export const CLAIM_TYPES = ["FACT", "DETECTION", "FORECAST", "EXPLANATION", "RECOMMENDATION", "AUTOMATION"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const ActionTierSchema = z.enum(["A0", "A1", "A2", "A3"]);
export type ActionTier = z.infer<typeof ActionTierSchema>;

/** A figure read from stored rows. */
export const FactPayloadSchema = z.strictObject({
  metricId: IdentifierSchema,
  value: ObservedSchema,
  sourceQueryId: IdentifierSchema,
});

/** A fact that crossed a rule or a baseline. */
export const DetectionPayloadSchema = z
  .strictObject({
    ruleId: IdentifierSchema,
    observed: ObservedSchema,
    baseline: z.strictObject({
      method: z.enum(["median_mad", "threshold"]),
      value: ObservedSchema,
      /** Weeks of history behind the baseline; 0 for a fixed threshold. */
      windowWeeks: z.number().int().min(0),
    }),
    deviationBps: z.number().int(),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .refine((d) => sameUnit(d.observed, d.baseline.value), {
    message: "observed and baseline must share one unit",
  });

/** An estimate of the future. Always a p10–p90 interval, never a bare number. */
export const ForecastPayloadSchema = z.strictObject({
  modelId: IdentifierSchema,
  modelVersion: IdentifierSchema,
  horizonDays: z.number().int().min(0),
  interval: IntervalSchema,
  backtest: z.strictObject({
    metric: z.enum(["WAPE", "MAE"]),
    modelErrorBps: z.number().int().min(0),
    naiveErrorBps: z.number().int().min(0),
    windowDays: z.number().int().min(1),
    provenance: z.enum(["LOCAL_SYNTHETIC", "APPROVED_EXPORT", "PRODUCTION_JOB"]),
  }),
  isNaiveFallback: z.boolean(),
  forecastIds: z.array(z.uuid()).min(1),
});

/**
 * Attribution of a change to drivers. The drivers plus the residual must add
 * up to the total exactly — an explanation that does not account for the
 * whole change says so through its residual, never by quietly not summing.
 */
export const ExplanationPayloadSchema = z
  .strictObject({
    method: IdentifierSchema,
    total: ObservedSchema,
    drivers: z.array(z.strictObject({ driverId: IdentifierSchema, contribution: ObservedSchema })).min(1),
    residual: EstimatedSchema,
  })
  .refine((e) => [e.residual, ...e.drivers.map((d) => d.contribution)].every((q) => sameUnit(q, e.total)), {
    message: "total, drivers and residual must share one unit",
  })
  .refine(
    (e) => {
      const parts = [e.residual, ...e.drivers.map((d) => d.contribution)];
      if (!parts.every((q) => sameUnit(q, e.total))) return true; // reported above
      return sumMagnitudes(parts) === magnitudeOf(e.total);
    },
    { message: "drivers plus residual must equal the total" },
  );

export const AssumptionSchema = z.strictObject({
  code: CodeSchema,
  value: EstimatedSchema.optional(),
});

/** A proposed action. An impact range, never a point, and it expires. */
export const RecommendationPayloadSchema = z.strictObject({
  recommendationId: z.uuid(),
  actionKind: IdentifierSchema,
  tier: ActionTierSchema,
  impact: RangeSchema,
  assumptions: z.array(AssumptionSchema).min(1),
  confidence: ConfidenceSchema,
  expiresAt: IstDateTimeSchema,
  evidenceInsightIds: z.array(z.uuid()).min(1),
});

/** One field of a before/after snapshot: a scalar, never a nested record. */
const SnapshotSchema = z.record(IdentifierSchema, z.union([z.string().max(200), z.number().int(), z.boolean(), z.null()]));

export const ApprovalRefSchema = z.union([
  z.strictObject({ by: z.uuid(), at: IstDateTimeSchema }),
  z.strictObject({ autoPolicyId: z.uuid(), autoPolicyVersion: z.number().int().min(1) }),
]);

/**
 * An action the system took or is waiting to take. A0 (publishing) runs
 * without approval; A1 runs under an auto policy or a person's approval; A2
 * only with a person's approval. A3 actions are handed
 * off to a person and never executed, so they are not an AUTOMATION.
 * `execution` exists so the presentation can tell "Done automatically" from
 * "Waiting approval"; the iq_actions row stays the owner of the status.
 */
export const AutomationPayloadSchema = z
  .strictObject({
    actionId: z.uuid(),
    actionKind: IdentifierSchema,
    tier: z.enum(["A0", "A1", "A2"]),
    execution: z.enum(["PENDING_APPROVAL", "EXECUTED"]),
    approvalRef: ApprovalRefSchema.nullable(),
    before: SnapshotSchema,
    after: SnapshotSchema,
    undo: z.strictObject({ kind: z.enum(["NONE", "REVERT", "COMPENSATING"]), available: z.boolean() }),
  })
  .refine((a) => a.execution === "EXECUTED" || (a.tier !== "A0" && a.approvalRef === null), {
    message: "a pending action has no approval yet, and A0 never waits for one",
  })
  .refine((a) => a.execution === "PENDING_APPROVAL" || (a.tier === "A0") === (a.approvalRef === null), {
    message: "an executed A1/A2 action has an approval reference; an A0 action needs none",
  })
  .refine((a) => a.tier !== "A2" || a.approvalRef === null || "by" in a.approvalRef, {
    message: "an A2 action is approved by a person, never by an auto policy",
  })
  .refine((a) => a.undo.kind !== "NONE" || !a.undo.available, {
    message: "undo cannot be available without an undo kind",
  });

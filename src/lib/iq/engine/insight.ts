/**
 * Insight — the envelope every engine output travels in.
 *
 * DESIGN.md §1.2 as amended by DESIGN-v2-DELTA.md §1. One discriminated
 * union on `claimType`; every variant is strict. On top of the per-claim
 * shapes, the envelope enforces what spans fields:
 *
 * - copy slots point at payload paths that exist, so prose can only cite a
 *   number the payload carries — and in a FORECAST or RECOMMENDATION a slot
 *   may cite the interval or range, never one estimated figure on its own;
 * - a RECOMMENDATION expires, and the envelope and payload agree on when;
 * - no key at any depth names a person's name, phone, email or address, and
 *   no string carries a bare 10-digit number (a phone). T7.
 */
import { z } from "zod";

import {
  AutomationPayloadSchema,
  DetectionPayloadSchema,
  ExplanationPayloadSchema,
  FactPayloadSchema,
  ForecastPayloadSchema,
  RecommendationPayloadSchema,
} from "./claims";
import { EvidenceSchema, IdentifierSchema, IstDateTimeSchema, PeriodSchema, Sha256HexSchema } from "./evidence";
import { IntervalSchema, QuantitySchema, RangeSchema } from "./quantity";
import { TrustRefSchema } from "./trust";

export const INSIGHT_SCHEMA_VERSION = 1;

export const SubjectKindSchema = z.enum([
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
]);

/** A dotted path into the payload: `value`, `interval.p50`, `drivers.0.contribution`. */
const PayloadPathSchema = z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/, "slot must be a dotted payload path");

export const CopySchema = z.strictObject({
  templateId: IdentifierSchema,
  slots: z.record(IdentifierSchema, PayloadPathSchema),
});
export type Copy = z.infer<typeof CopySchema>;

const BaseShape = {
  id: z.uuid(),
  orgId: z.uuid(),
  locationId: z.uuid().nullable(),
  schemaVersion: z.literal(INSIGHT_SCHEMA_VERSION),
  producer: IdentifierSchema,
  subject: z.strictObject({ kind: SubjectKindSchema, ref: IdentifierSchema }),
  period: PeriodSchema,
  dedupeKey: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:\-/]+$/),
  evidence: z.array(EvidenceSchema).min(1),
  trust: TrustRefSchema,
  copy: CopySchema,
  status: z.enum(["ACTIVE", "SUPERSEDED", "EXPIRED", "RETRACTED"]),
  producedBy: z.strictObject({
    job: IdentifierSchema,
    runId: z.uuid(),
    attempt: z.number().int().min(1),
    codeVersion: z.string().regex(/^[0-9a-f]{7,40}$/, "codeVersion must be a git sha"),
  }),
  /** sha256 of the canonical JSON of payload + evidence; see content-hash.ts. */
  contentHash: Sha256HexSchema,
  supersedes: z.uuid().nullable(),
  createdAt: IstDateTimeSchema,
  expiresAt: IstDateTimeSchema.nullable(),
};

export const InsightSchema = z
  .discriminatedUnion("claimType", [
    z.strictObject({ ...BaseShape, claimType: z.literal("FACT"), payload: FactPayloadSchema }),
    z.strictObject({ ...BaseShape, claimType: z.literal("DETECTION"), payload: DetectionPayloadSchema }),
    z.strictObject({ ...BaseShape, claimType: z.literal("FORECAST"), payload: ForecastPayloadSchema }),
    z.strictObject({ ...BaseShape, claimType: z.literal("EXPLANATION"), payload: ExplanationPayloadSchema }),
    z.strictObject({ ...BaseShape, claimType: z.literal("RECOMMENDATION"), payload: RecommendationPayloadSchema }),
    z.strictObject({ ...BaseShape, claimType: z.literal("AUTOMATION"), payload: AutomationPayloadSchema }),
  ])
  .superRefine((insight, ctx) => {
    for (const [slot, path] of Object.entries(insight.copy.slots)) {
      const kind = classifySlotValue(resolvePayloadPath(insight.payload, path));
      if (reachesInsideAFigure(insight.payload, path)) {
        ctx.addIssue({ code: "custom", path: ["copy", "slots", slot], message: `slot must cite a whole quantity, interval or range, not a part of one: ${path}` });
      } else if (kind === null) {
        ctx.addIssue({ code: "custom", path: ["copy", "slots", slot], message: `slot does not point at a citable payload value: ${path}` });
      } else if (kind === "quantity" && (insight.claimType === "FORECAST" || insight.claimType === "RECOMMENDATION")) {
        ctx.addIssue({ code: "custom", path: ["copy", "slots", slot], message: `a ${insight.claimType} slot must cite its interval or range, not a bare figure: ${path}` });
      }
    }

    if (insight.claimType === "RECOMMENDATION" && insight.expiresAt !== insight.payload.expiresAt) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "a recommendation's expiresAt must match its payload" });
    }

    for (const finding of findPersonalData(insight)) {
      ctx.addIssue({ code: "custom", path: finding.path, message: finding.message });
    }
  });

export type Insight = z.output<typeof InsightSchema>;
export type InsightOf<C extends Insight["claimType"]> = Extract<Insight, { claimType: C }>;

/**
 * Follows a dotted path into a payload. Returns the value, or undefined when
 * any segment is missing. Array segments are decimal indexes.
 */
export function resolvePayloadPath(payload: unknown, path: string): unknown {
  let node: unknown = payload;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
      node = node[Number(segment)];
    } else {
      if (!Object.hasOwn(node, segment)) return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
  }
  return node;
}

export type SlotValueKind = "scalar" | "quantity" | "interval" | "range";

/** What a copy slot may cite: a scalar, a quantity, an interval or a range. Anything else is null. */
export function classifySlotValue(value: unknown): SlotValueKind | null {
  if (typeof value === "string" || typeof value === "boolean") return "scalar";
  if (typeof value === "number") return Number.isFinite(value) ? "scalar" : null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (QuantitySchema.safeParse(value).success) return "quantity";
  if (IntervalSchema.safeParse(value).success) return "interval";
  if (RangeSchema.safeParse(value).success) return "range";
  return null;
}

/**
 * True when a path steps into a quantity, interval or range — `interval.p50`
 * or `impact.low.value`. Citing a part would print one estimated figure as a
 * bare number, which is exactly what the contract exists to prevent.
 */
function reachesInsideAFigure(payload: unknown, path: string): boolean {
  const segments = path.split(".");
  for (let i = 1; i < segments.length; i += 1) {
    const kind = classifySlotValue(resolvePayloadPath(payload, segments.slice(0, i).join(".")));
    if (kind === "quantity" || kind === "interval" || kind === "range") return true;
  }
  return false;
}

const PERSONAL_KEY_WORDS = new Set(["name", "phone", "mobile", "email", "address"]);

/** A standalone 10-digit run, optionally +91-prefixed — the shape of an Indian phone number. */
const PHONE_LIKE = /(?<![0-9A-Za-z])(?:\+?91[\s-]?)?\d{10}(?![0-9A-Za-z])/;

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export type PersonalDataFinding = { path: (string | number)[]; message: string };

/**
 * Walks any value and reports keys that name personal data and strings that
 * look like a phone number. A quantity's own value is skipped: ₹1 crore is
 * ten digits of paise and is not a phone.
 */
export function findPersonalData(value: unknown, path: (string | number)[] = []): PersonalDataFinding[] {
  if (typeof value === "string") {
    return PHONE_LIKE.test(value) ? [{ path, message: "string looks like a phone number" }] : [];
  }
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => findPersonalData(item, [...path, i]));
  if (QuantitySchema.safeParse(value).success) return [];

  const findings: PersonalDataFinding[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (keyWords(key).some((w) => PERSONAL_KEY_WORDS.has(w))) {
      findings.push({ path: [...path, key], message: `key "${key}" names personal data` });
    }
    findings.push(...findPersonalData(child, [...path, key]));
  }
  return findings;
}

export type ParsedInsights = {
  valid: Insight[];
  /** Rows that failed the contract. They are dropped, never shown, and counted. */
  dropped: number;
  issues: { index: number; messages: string[] }[];
};

/** The read boundary: invalid rows are dropped and counted, never rendered. §1.4 (5) */
export function parseInsights(rows: readonly unknown[]): ParsedInsights {
  const result: ParsedInsights = { valid: [], dropped: 0, issues: [] };
  rows.forEach((row, index) => {
    const parsed = InsightSchema.safeParse(row);
    if (parsed.success) {
      result.valid.push(parsed.data);
    } else {
      result.dropped += 1;
      result.issues.push({ index, messages: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
  });
  return result;
}

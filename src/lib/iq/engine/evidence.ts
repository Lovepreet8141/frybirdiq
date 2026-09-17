/**
 * Evidence — what an insight rests on, by reference only.
 *
 * DESIGN.md §1.2. Evidence points at rows (a metric for a period, another
 * insight, a stored query, a forecast, an action); it never copies their
 * content, so it cannot carry a customer's name or number.
 */
import { z } from "zod";

/** Machine identifiers: metric ids, rule ids, model ids, codes. No spaces, no prose. */
export const IdentifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_.:-]*$/, "identifier must be lower-case letters, digits, _ . : -");

/** Upper-snake reason and assumption codes: `LOW_VOLUME`, `PRICE_UNCHANGED`. */
export const CodeSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/, "code must be UPPER_SNAKE");

export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected a sha256 hex digest");

/** Timestamps carry the IST offset explicitly; business periods are IST. */
export const IstDateTimeSchema = z.iso
  .datetime({ offset: true })
  .refine((s) => s.endsWith("+05:30"), { message: "timestamp must carry the IST offset +05:30" });

export const PeriodSchema = z
  .strictObject({ start: IstDateTimeSchema, end: IstDateTimeSchema })
  .refine((p) => Date.parse(p.start) <= Date.parse(p.end), { message: "period must start before it ends" });
export type Period = z.infer<typeof PeriodSchema>;

export const EvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("metric"),
    metricId: IdentifierSchema,
    period: PeriodSchema,
    locationId: z.uuid().optional(),
  }),
  z.strictObject({ kind: z.literal("insight"), insightId: z.uuid() }),
  z.strictObject({ kind: z.literal("query"), sourceId: IdentifierSchema, paramsHash: Sha256HexSchema }),
  z.strictObject({ kind: z.literal("forecast"), forecastId: z.uuid() }),
  z.strictObject({ kind: z.literal("action"), actionId: z.uuid() }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

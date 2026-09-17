/**
 * Trust and confidence.
 *
 * DESIGN.md §1.2. Trust says how far the underlying data can be relied on;
 * scoring it is iq-1. Until then an insight states NOT_MEASURED, and the
 * presentation says so rather than implying the data is sound.
 *
 * Confidence is separate: how sure a recommendation is of its own impact.
 */
import { z } from "zod";

import { CodeSchema, IdentifierSchema, IstDateTimeSchema } from "./evidence";

export const TrustRefSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("MEASURED"),
    score: z.number().int().min(0).max(100),
    asOf: IstDateTimeSchema,
    metricIds: z.array(IdentifierSchema).min(1),
    reasons: z.array(CodeSchema),
  }),
  z.strictObject({ state: z.literal("NOT_MEASURED") }),
  z.strictObject({ state: z.literal("INSUFFICIENT_DATA"), reasons: z.array(CodeSchema).min(1) }),
]);
export type TrustRef = z.infer<typeof TrustRefSchema>;

export const ConfidenceSchema = z.strictObject({
  level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasons: z.array(CodeSchema).min(1),
});
export type Confidence = z.infer<typeof ConfidenceSchema>;

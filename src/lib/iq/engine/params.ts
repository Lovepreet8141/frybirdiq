/**
 * Action params — what a recommendation or action would do, and its identity.
 *
 * SECURITY-TENANCY review of ab9c45c. Params are stored on
 * iq_recommendations and iq_actions and later executed, so:
 *
 * - R1: they are a flat record of scalars under identifier keys (strings up
 *   to 200 characters, safe integers, booleans, null), at most 32 keys, with
 *   no key naming personal data and no phone-shaped value — the same T7 rule
 *   the Insight envelope applies.
 * - R2: their identity is `actionParamsHash`, sha256 of the canonical JSON,
 *   computed on the server from the params themselves. Cooldown, the
 *   open-duplicate index and approval all bind to this hash, so it must never
 *   be taken from a caller: a hash that disagreed with the params would let
 *   one action be approved and another executed.
 */
import { z } from "zod";

import { canonicalJson, sha256Hex } from "./content-hash";
import { IdentifierSchema } from "./evidence";
import { findPersonalData } from "./insight";

export const MAX_PARAM_KEYS = 32;

/**
 * Identifier keys are lower-case, so "customerName" arrives as "customername"
 * and word splitting cannot see the name in it. Params are stricter than the
 * envelope: a banned word anywhere inside a key is refused.
 */
const PERSONAL_KEY_FRAGMENT = /name|phone|mobile|email|address/;

export const ActionParamsSchema = z
  .record(IdentifierSchema, z.union([z.string().max(200), z.number().int(), z.boolean(), z.null()]))
  .refine((params) => Object.keys(params).length <= MAX_PARAM_KEYS, {
    message: `action params allow at most ${MAX_PARAM_KEYS} keys`,
  });
export type ActionParams = z.infer<typeof ActionParamsSchema>;

/** Validates params and refuses personal data. Throws with a message naming the rule, never the value. */
export function parseActionParams(params: unknown): ActionParams {
  const parsed = ActionParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`invalid action params: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const findings = findPersonalData(parsed.data);
  for (const key of Object.keys(parsed.data)) {
    if (PERSONAL_KEY_FRAGMENT.test(key)) findings.push({ path: [key], message: `key "${key}" names personal data` });
  }
  if (findings.length > 0) {
    throw new Error(`invalid action params: ${findings.map((f) => `${f.path.join(".")} ${f.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** sha256 hex of the canonical JSON of validated params. Key order does not matter. */
export async function actionParamsHash(params: ActionParams): Promise<string> {
  return sha256Hex(canonicalJson(parseActionParams(params)));
}

/**
 * WhatsApp webhook (Meta) — part 1 of whatsapp-direct. Only the GET verify
 * handshake and the POST signature check live here; no message is read,
 * stored or sent. `src/app/api/whatsapp/webhook/route.ts` is the thin
 * request/response shell around these pure functions, the same split as
 * `src/lib/payments/razorpay.ts`'s signature helpers and its webhook route.
 *
 * Both secrets are read directly from `process.env`, not through
 * `serverEnv()` — this route never touches the database, so it should not
 * need the rest of the server environment's schema just to answer a ping
 * (same reasoning as `razorpayConfig()` and `whatsappUpdatesEnabled()`).
 *
 * Meta's payload carries customer phone numbers and message text under
 * `entry[].changes[].value`; this module only ever reads `object` and
 * `entry[].changes[].field` (e.g. "messages") and never touches `value` —
 * so there is nothing to accidentally log.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function whatsappVerifyToken(): string | null {
  return process.env.WHATSAPP_VERIFY_TOKEN?.trim() || null;
}

export function whatsappAppSecret(): string | null {
  return process.env.WHATSAPP_APP_SECRET?.trim() || null;
}

function safeEqualUtf8(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Meta's GET verify handshake
 * (developers.facebook.com/docs/graph-api/webhooks/getting-started):
 * `hub.mode` must be "subscribe" and `hub.verify_token` must match, in
 * constant time. `configuredToken` missing (WHATSAPP_VERIFY_TOKEN unset)
 * fails closed — nobody can ever pass an unset token.
 */
export function verifyHandshake(input: { mode: string | null; token: string | null; configuredToken: string | null }): boolean {
  if (!input.configuredToken) return false;
  if (input.mode !== "subscribe") return false;
  if (!input.token) return false;
  return safeEqualUtf8(input.token, input.configuredToken);
}

/**
 * `X-Hub-Signature-256: sha256=<hex>` over the exact raw request body, HMAC'd
 * with the app secret, compared in constant time. `appSecret` missing
 * (WHATSAPP_APP_SECRET unset) fails closed — nobody can ever pass an unset
 * secret, so a webhook received before the owner has typed it in is refused,
 * not silently trusted.
 */
export function verifySignature(input: { body: string; header: string | null; appSecret: string | null }): boolean {
  if (!input.appSecret) return false;
  if (!input.header) return false;
  const prefix = "sha256=";
  if (!input.header.startsWith(prefix)) return false;
  const provided = input.header.slice(prefix.length).trim().toLowerCase();
  const expected = createHmac("sha256", input.appSecret).update(input.body).digest("hex");
  return safeEqualHex(expected, provided);
}

const webhookBodySchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z.array(z.object({ field: z.string().optional() })).optional(),
      }),
    )
    .optional(),
});

export interface WhatsappWebhookEventSummary {
  readonly object: string | null;
  readonly fields: readonly string[];
}

/**
 * What to log about a verified event: `object` (e.g.
 * "whatsapp_business_account") and each change's `field` (e.g. "messages",
 * "message_template_status_update") — never `value`, where the phone numbers
 * and message text live. Malformed or unexpected JSON returns an empty
 * summary rather than throwing: this is only ever used for a log line, never
 * for a decision.
 */
export function eventTypesOf(rawBody: string): WhatsappWebhookEventSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { object: null, fields: [] };
  }
  const result = webhookBodySchema.safeParse(parsed);
  if (!result.success) return { object: null, fields: [] };
  const fields = (result.data.entry ?? [])
    .flatMap((entry) => entry.changes ?? [])
    .map((change) => change.field)
    .filter((field): field is string => Boolean(field));
  return { object: result.data.object ?? null, fields };
}

/**
 * MOCK ONLY - NOT VERIFIED AGAINST PAYTM SANDBOX - CANNOT GO LIVE until the checksum is proven with real sandbox credentials
 *
 * Paytm Payment Gateway. docs/PAYTM-PROVIDER.md is the reference for every
 * endpoint, field and assumption in this file.
 *
 * A third implementation of `PaymentProvider`. It creates the Paytm
 * transaction for exactly the paise the server says is due, verifies
 * callbacks and every gateway answer by checksum, and asks for refunds. What
 * it never does: touch the database, decide an order's status, or believe a
 * callback. A callback only says "go and look": `capture` ALWAYS asks Paytm's
 * Transaction Status API, and only a TXN_SUCCESS for our order id and our
 * amount is ok. Everything else fails closed: pending, unknown, a missing
 * record or a bad response signature are never "paid".
 *
 * Fetch only, no SDK, so there is nothing between this file and the wire to
 * audit. The checksum is the one non-standard part; see the notes on
 * `generateChecksum`: it follows Paytm's published checksum library and its
 * known-answer test has to be run against Paytm's sandbox before go-live.
 *
 * Identifiers: our order id is the Paytm `orderId` (so a retry can never open a
 * second Paytm order for the same order). The stored `providerPaymentId` is
 * `<orderId>:<txnId>`, because a Paytm refund needs both and the interface
 * passes a refund only the payment id.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type Paise, ZERO, paise } from "@/lib/money";
import type {
  CaptureFailureCode,
  PaymentIntent,
  PaymentMethod,
  PaymentProvider,
  PaymentResult,
  RefundLookup,
  RefundResult,
  WebhookVerification,
} from "./provider";

export const PAYTM_PROVIDER = "paytm";
export const PAYTM_TIMEOUT_MS = 8_000;

/**
 * Whether the checksum scheme in this file has been proven against a real
 * Paytm sandbox response. It is false, and it flips to true ONLY in a commit
 * made after the owner's staging credentials have shown Paytm accepting our
 * signature and our code verifying Paytm's (docs/PAYTM-PROVIDER.md, "Sandbox
 * proof procedure"). While false, `PAYTM_ENV=production` is refused, so no
 * real money can ever go through an unproven checksum; staging stays allowed
 * because that is how the proof is made.
 */
export const PAYTM_SANDBOX_VERIFIED = false;

export const PAYTM_NOT_VERIFIED_MESSAGE = "paytm is not verified against Paytm sandbox, so production is refused";

/** The one rule: production needs a verified sandbox proof; staging never does. Pure, so all four combinations are testable. */
export function paytmEnvAllowed(env: "staging" | "production", sandboxVerified: boolean): boolean {
  return env === "staging" || sandboxVerified;
}

/** Why the provider cannot be used right now, or null when it can. For error messages only; never decides anything itself. */
export function paytmUnavailableReason(): string | null {
  if (process.env.PAYTM_ENV?.trim() === "production" && !PAYTM_SANDBOX_VERIFIED) return PAYTM_NOT_VERIFIED_MESSAGE;
  return isPaytmConfigured() ? null : "paytm is not configured";
}

export interface PaytmConfig {
  readonly mid: string;
  readonly merchantKey: string;
  readonly websiteName: string;
  readonly env: "staging" | "production";
  readonly callbackUrl: string;
}

/** The only reader of PAYTM_* (declared in src/lib/env). Null unless every value is present and the key is usable. */
export function paytmConfig(): PaytmConfig | null {
  const mid = process.env.PAYTM_MID?.trim();
  const merchantKey = process.env.PAYTM_MERCHANT_KEY?.trim();
  const websiteName = process.env.PAYTM_WEBSITE_NAME?.trim();
  const env = process.env.PAYTM_ENV?.trim();
  const callbackUrl = process.env.PAYTM_CALLBACK_URL?.trim();
  if (!mid || !merchantKey || !websiteName || !callbackUrl) return null;
  if (env !== "staging" && env !== "production") return null;
  if (!paytmEnvAllowed(env, PAYTM_SANDBOX_VERIFIED)) return null;
  // AES-128: the merchant key is exactly 16 bytes. Anything else cannot sign.
  if (Buffer.byteLength(merchantKey, "utf8") !== 16) return null;
  return { mid, merchantKey, websiteName, env, callbackUrl };
}

export function isPaytmConfigured(): boolean {
  return paytmConfig() !== null;
}

/* ------------------------------------------------------------------ */
/* Checksum                                                            */
/* ------------------------------------------------------------------ */

/** The fixed IV in Paytm's checksum library. It is public; the secrecy is the merchant key. */
const IV = Buffer.from("@@@@&&&&####$$$$", "utf8");

function aesKey(merchantKey: string): Buffer {
  const key = Buffer.from(merchantKey, "utf8");
  if (key.length !== 16) throw new RangeError("paytm: the merchant key must be 16 bytes");
  return key;
}

/** The library's 4-character salt: 3 random bytes, base64. */
function newSalt(): string {
  return randomBytes(3).toString("base64");
}

function hashWithSalt(message: string, salt: string): string {
  return createHash("sha256").update(`${message}|${salt}`).digest("hex") + salt;
}

/**
 * Checksum over a string (a JSON body for API calls): sha256(message|salt) in
 * hex followed by the salt, AES-128-CBC encrypted under the merchant key with
 * the fixed IV, base64. `salt` is injectable only for deterministic tests.
 */
export function generateChecksum(message: string, merchantKey: string, salt: string = newSalt()): string {
  const cipher = createCipheriv("aes-128-cbc", aesKey(merchantKey), IV);
  return Buffer.concat([cipher.update(hashWithSalt(message, salt), "utf8"), cipher.final()]).toString("base64");
}

/** Recomputes the hash from the decrypted salt and compares in constant time. Any malformed input is false, never a throw. */
export function verifyChecksum(message: string, merchantKey: string, checksum: string): boolean {
  try {
    if (!checksum) return false;
    const decipher = createDecipheriv("aes-128-cbc", aesKey(merchantKey), IV);
    const plain = Buffer.concat([decipher.update(Buffer.from(checksum, "base64")), decipher.final()]).toString("utf8");
    if (plain.length !== 68) return false;
    const salt = plain.slice(-4);
    const expected = Buffer.from(hashWithSalt(message, salt), "utf8");
    const actual = Buffer.from(plain, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** A callback's fields as the library signs them: keys sorted, values joined by `|`, null or "null" as empty. */
export function callbackChecksumMessage(params: Readonly<Record<string, unknown>>): string {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      if (value === null || value === undefined) return "";
      const text = String(value);
      return text.toLowerCase() === "null" ? "" : text;
    })
    .join("|");
}

/** Verifies a callback or webhook's fields; `CHECKSUMHASH` itself is excluded from what is signed. */
export function verifyCallbackParams(params: Readonly<Record<string, unknown>>, merchantKey: string): boolean {
  const { CHECKSUMHASH, ...rest } = params;
  return typeof CHECKSUMHASH === "string" && verifyChecksum(callbackChecksumMessage(rest), merchantKey, CHECKSUMHASH);
}

/* ------------------------------------------------------------------ */
/* Amounts                                                             */
/* ------------------------------------------------------------------ */

/** Paytm's wire format is a rupee string with two decimals. Wire format only, never display. */
export function toPaytmAmount(amount: Paise): string {
  if (amount <= ZERO) throw new RangeError(`paytm: cannot charge ${amount.toString()} paise`);
  const whole = amount / 100n;
  const frac = (amount % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${frac}`;
}

/** Strict inverse: digits with at most two decimals, else null. */
export function fromPaytmAmount(value: unknown): Paise | null {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return null;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return paise(BigInt(m[1] as string) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0"));
}

/** `<orderId>:<txnId>`. Paytm order ids never contain a colon. */
export function composePaymentId(orderId: string, txnId: string): string {
  return `${orderId}:${txnId}`;
}

export function splitPaymentId(id: string | null | undefined): { orderId: string; txnId: string } | null {
  if (!id) return null;
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) return null;
  return { orderId: id.slice(0, i), txnId: id.slice(i + 1) };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function hosts(config: PaytmConfig) {
  const staging = config.env === "staging";
  return {
    initiate: staging ? "https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction" : "https://securegw.paytm.in/theia/api/v1/initiateTransaction",
    // ASSUMPTION: the status page did not print its URL; this is Paytm's long-standing v3 endpoint.
    status: staging ? "https://securegw-stage.paytm.in/v3/order/status" : "https://securegw.paytm.in/v3/order/status",
    refund: staging ? "https://securestage.paytmpayments.com/refund/apply" : "https://secureglobal.paytmpayments.com/refund/apply",
    refundStatus: staging ? "https://securestage.paytmpayments.com/v2/refund/status" : "https://paytmpayments.com/v2/refund/status",
  };
}

interface PaytmEnvelope {
  readonly head?: { readonly signature?: string };
  readonly body?: Record<string, unknown> & { readonly resultInfo?: PaytmResultInfo };
}

interface PaytmResultInfo {
  readonly resultStatus?: string;
  readonly resultCode?: string;
  readonly resultMsg?: string;
}

type CallResult = { ok: true; envelope: PaytmEnvelope; status: number } | { ok: false; error: string; status: number | null };

/**
 * POSTs a signed request. The signature is over exactly the JSON string sent
 * as `body`, so a repeat of the same input is a byte-identical request. The
 * response is only returned as ok when its own head.signature verifies over
 * JSON.stringify(body): an unsigned or wrongly signed answer is an error, and
 * callers treat that as unknown, never as success or failure.
 */
async function call(config: PaytmConfig, url: string, body: Record<string, unknown>): Promise<CallResult> {
  const bodyText = JSON.stringify(body);
  const payload = `{"body":${bodyText},"head":{"signature":${JSON.stringify(generateChecksum(bodyText, config.merchantKey))}}}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      cache: "no-store",
      signal: AbortSignal.timeout(PAYTM_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: `Paytm could not be reached (${error instanceof Error ? error.message : "network error"}).`, status: null };
  }
  const text = await response.text();
  let envelope: PaytmEnvelope | null = null;
  try {
    envelope = text ? (JSON.parse(text) as PaytmEnvelope) : null;
  } catch {
    envelope = null;
  }
  if (!response.ok) return { ok: false, error: `Paytm returned ${response.status}.`, status: response.status };
  if (!envelope?.body || typeof envelope.head?.signature !== "string") return { ok: false, error: "Paytm sent an unreadable answer.", status: response.status };
  if (!verifyChecksum(JSON.stringify(envelope.body), config.merchantKey, envelope.head.signature)) {
    return { ok: false, error: "Paytm's answer did not verify.", status: response.status };
  }
  return { ok: true, envelope, status: response.status };
}

/* ------------------------------------------------------------------ */
/* Transaction status (the authority for capture)                      */
/* ------------------------------------------------------------------ */

type StatusVerdict =
  | { readonly kind: "success"; readonly txnId: string; readonly amount: Paise; readonly mode: string | null }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "not_yet" }
  | { readonly kind: "mismatch"; readonly message: string };

/**
 * A Transaction Status body, judged. Only TXN_SUCCESS for our order id and
 * our amount is a success. TXN_FAILURE is final. PENDING, NO_RECORD_FOUND and
 * any status not listed here are "not yet": retried, never booked.
 */
export function classifyPaytmStatus(body: NonNullable<PaytmEnvelope["body"]>, expected: { orderId: string; amount: Paise }): StatusVerdict {
  const info = body.resultInfo ?? {};
  switch (info.resultStatus) {
    case "TXN_SUCCESS": {
      if (body.orderId !== expected.orderId) return { kind: "mismatch", message: "That payment belongs to a different order." };
      const amount = fromPaytmAmount(body.txnAmount);
      if (amount === null || amount !== expected.amount) return { kind: "mismatch", message: "The amount Paytm captured does not match the order." };
      if (typeof body.txnId !== "string" || body.txnId === "") return { kind: "not_yet" };
      return { kind: "success", txnId: body.txnId, amount, mode: typeof body.paymentMode === "string" ? body.paymentMode : null };
    }
    case "TXN_FAILURE":
      return { kind: "failed", message: info.resultMsg ? `Paytm: ${info.resultMsg.slice(0, 120)}` : "The payment failed." };
    default:
      return { kind: "not_yet" };
  }
}

export function methodFromPaytm(mode: string | null | undefined): PaymentMethod {
  switch (mode) {
    case "UPI":
      return "UPI";
    case "CC":
    case "DC":
      return "CARD";
    case "NB":
      return "NETBANKING";
    case "PPI":
      return "WALLET";
    default:
      return "OTHER";
  }
}

function fail(providerPaymentId: string | null, error: string, code: CaptureFailureCode, verified = false): PaymentResult {
  return { ok: false, providerPaymentId, capturedAmount: ZERO, error, code, ...(verified ? { payload: { gatewayVerified: true } } : {}) };
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

const PENDING_CODES = new Set(["601", "628", "677"]);
/** "Duplicate refund within 10 minutes" and "already successful": the refund may well exist, so look it up. */
const LOOKUP_CODES = new Set(["617", "629"]);

export function refundRequestBody(config: PaytmConfig, input: { orderId: string; txnId: string; amount: Paise; reason: string; refundId: string }) {
  return {
    mid: config.mid,
    txnType: "REFUND",
    orderId: input.orderId,
    txnId: input.txnId,
    refId: input.refundId,
    refundAmount: toPaytmAmount(input.amount),
    comments: input.reason.slice(0, 500),
  };
}

/**
 * A refund answer, classified. TXN_SUCCESS with the amount asked is money
 * back. PENDING (and the pending codes) stay reserved. TXN_FAILURE is refused
 * unless the code says the refund may already exist. Anything else, or the
 * wrong amount, is ambiguous: never booked, never released.
 */
export function classifyPaytmRefund(body: NonNullable<PaytmEnvelope["body"]>, expectedAmount: Paise | null, httpStatus: number | null): RefundResult {
  const info = body.resultInfo ?? {};
  const code = info.resultCode ?? "";
  const providerRefundId = typeof body.refundId === "string" ? body.refundId : null;
  const base = { providerRefundId, refundedAmount: ZERO, httpStatus };
  if (LOOKUP_CODES.has(code)) return { ...base, outcome: "ambiguous", error: "Paytm says this refund may already exist. Check it before doing anything else." };
  if (PENDING_CODES.has(code) || info.resultStatus === "PENDING") return { ...base, outcome: "pending", error: "Paytm has accepted the refund and is still processing it." };
  if (info.resultStatus === "TXN_SUCCESS") {
    const amount = fromPaytmAmount(body.refundAmount);
    if (amount === null || (expectedAmount !== null && amount !== expectedAmount)) {
      return { ...base, outcome: "ambiguous", error: "Paytm refunded a different amount than was asked. Check the Paytm dashboard before doing anything else." };
    }
    return { ...base, outcome: "succeeded", refundedAmount: amount };
  }
  if (info.resultStatus === "TXN_FAILURE") return { ...base, outcome: "refused", error: info.resultMsg ? `Paytm: ${info.resultMsg.slice(0, 120)}` : "Paytm could not make the refund." };
  return { ...base, outcome: "ambiguous", error: `Paytm reported the refund as ${String(info.resultStatus)}.` };
}

/** A failed call, by what it proves: a definite 4xx is a refusal; 409, 429, 5xx, a timeout, a bad signature or a network error proves nothing. */
export function classifyPaytmRefundFailure(error: string, httpStatus: number | null): RefundResult {
  const definitive = httpStatus !== null && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 409 && httpStatus !== 429 && httpStatus !== 408;
  return { outcome: definitive ? "refused" : "ambiguous", providerRefundId: null, refundedAmount: ZERO, httpStatus, error };
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

export interface PaytmInitiated {
  readonly providerOrderId: string;
  /** Handed to Paytm's checkout on the client. The interface has no field for it yet; see docs/PAYTM-PROVIDER.md. */
  readonly txnToken: string;
}

/**
 * Opens the Paytm transaction. The Paytm orderId IS our order id, so a retry
 * of the same request reaches the same Paytm order and cannot open a second
 * one; the request carries no timestamp or random value, so it is
 * byte-identical each time. The intent is created before the order row (owner
 * decision), so `orderId` here is the id reserved for that order.
 */
export async function initiatePaytmTransaction(input: { orderId: string; amount: Paise }): Promise<PaytmInitiated> {
  const config = paytmConfig();
  if (!config) throw new Error("paytm: not configured");
  if (!/^[A-Za-z0-9@_.-]{1,50}$/.test(input.orderId)) throw new RangeError("paytm: order id is not valid for Paytm");
  const result = await call(config, `${hosts(config).initiate}?mid=${encodeURIComponent(config.mid)}&orderId=${encodeURIComponent(input.orderId)}`, {
    requestType: "Payment",
    mid: config.mid,
    websiteName: config.websiteName,
    orderId: input.orderId,
    callbackUrl: config.callbackUrl,
    txnAmount: { value: toPaytmAmount(input.amount), currency: "INR" },
    userInfo: { custId: input.orderId },
  });
  if (!result.ok) throw new Error(result.error);
  const body = result.envelope.body ?? {};
  const token = (body as { txnToken?: unknown }).txnToken;
  if (body.resultInfo?.resultStatus !== "S" || typeof token !== "string" || token === "") {
    throw new Error(`paytm: could not start the payment${body.resultInfo?.resultMsg ? ` (${body.resultInfo.resultMsg.slice(0, 80)})` : ""}`);
  }
  return { providerOrderId: input.orderId, txnToken: token };
}

export const paytmProvider: PaymentProvider = {
  name: PAYTM_PROVIDER,
  supportedMethods: ["UPI", "CARD", "NETBANKING", "WALLET"],

  async createIntent({ orderId, amount, method }): Promise<PaymentIntent> {
    const started = await initiatePaytmTransaction({ orderId, amount });
    return { orderId, amount, method, providerOrderId: started.providerOrderId, requiresCustomerAction: true };
  },

  /**
   * Confirms Paytm took the money. Never trusts the callback: asks the
   * Transaction Status API for our order and requires TXN_SUCCESS, our order
   * id and exactly our amount. `signature` (a callback CHECKSUMHASH) is not
   * used here because a lone hash cannot be verified without the callback's
   * other fields; use `verifyWebhook` for that, and this call as the authority.
   */
  async capture({ orderId, amount, providerPaymentId, providerOrderId }): Promise<PaymentResult> {
    const config = paytmConfig();
    if (!config) return fail(null, "Online payment is not set up.", "GATEWAY_UNAVAILABLE");
    const split = splitPaymentId(providerPaymentId);
    const paytmOrderId = providerOrderId ?? split?.orderId ?? null;
    if (!paytmOrderId) return fail(null, "No Paytm order id was given.", "UNVERIFIED");
    if (paytmOrderId !== orderId || (split && split.orderId !== paytmOrderId)) return fail(providerPaymentId ?? null, "That payment belongs to a different order.", "UNVERIFIED");

    const result = await call(config, hosts(config).status, { mid: config.mid, orderId: paytmOrderId });
    // Nobody answered, or the answer could not be verified: money may have moved, so retryable, never final.
    if (!result.ok) return fail(providerPaymentId ?? null, result.error, "GATEWAY_UNAVAILABLE");

    const verdict = classifyPaytmStatus(result.envelope.body ?? {}, { orderId: paytmOrderId, amount });
    switch (verdict.kind) {
      case "success": {
        const rawTxn = split?.txnId ?? providerPaymentId ?? null;
        if (rawTxn && rawTxn !== verdict.txnId) return fail(providerPaymentId ?? null, "That transaction is not the one Paytm holds for this order.", "GATEWAY_DECLINED", true);
        return {
          ok: true,
          providerPaymentId: composePaymentId(paytmOrderId, verdict.txnId),
          capturedAmount: verdict.amount,
          payload: { method: methodFromPaytm(verdict.mode), paytmMode: verdict.mode, orderId: paytmOrderId, verifiedBy: "status-api" },
        };
      }
      case "failed":
        return fail(providerPaymentId ?? null, verdict.message, "GATEWAY_DECLINED", true);
      case "mismatch":
        return fail(providerPaymentId ?? null, verdict.message, "GATEWAY_DECLINED", true);
      case "not_yet":
        return fail(providerPaymentId ?? null, "Paytm has not confirmed this payment yet.", "GATEWAY_UNAVAILABLE");
    }
  },

  /** `refundId` is sent as Paytm's `refId`: a repeat with the same row is the same refund, and a resumed one finds it through `findRefund`. */
  async refund({ providerPaymentId, amount, reason, refundId }): Promise<RefundResult> {
    const config = paytmConfig();
    const none = (error: string): RefundResult => ({ outcome: "refused", providerRefundId: null, refundedAmount: ZERO, httpStatus: null, error });
    if (!config) return none("Online payment is not set up.");
    const split = splitPaymentId(providerPaymentId);
    if (!split) return none("No Paytm payment to refund.");
    const result = await call(config, hosts(config).refund, refundRequestBody(config, { ...split, amount, reason, refundId }));
    if (!result.ok) return classifyPaytmRefundFailure(result.error, result.status);
    return classifyPaytmRefund(result.envelope.body ?? {}, amount, result.status);
  },

  async findRefund({ providerPaymentId, refundId }): Promise<RefundLookup> {
    const config = paytmConfig();
    if (!config) return { found: "unknown", error: "Online payment is not set up." };
    const split = splitPaymentId(providerPaymentId);
    if (!split) return { found: false };
    const result = await call(config, hosts(config).refundStatus, { mid: config.mid, orderId: split.orderId, refId: refundId });
    if (!result.ok) return { found: "unknown", error: result.error };
    const body = result.envelope.body ?? {};
    const info = body.resultInfo ?? {};
    // Paytm's own "no such refund": a real answer, not a failure to ask.
    if (info.resultStatus === "NO_RECORD_FOUND" || info.resultCode === "631") return { found: false };
    const outcome = classifyPaytmRefund(body, null, result.status);
    if (outcome.outcome === "ambiguous") return { found: "unknown", error: outcome.error ?? "Paytm's refund status was not clear." };
    return { found: true, result: outcome };
  },

  /**
   * Verifies a callback or webhook. `body` is the callback's fields as JSON
   * (the route converts Paytm's form post to it); the checksum is
   * `signature`, or the body's own CHECKSUMHASH. The event id is
   * `<ORDERID>:<TXNID>:<STATUS>`: stable across Paytm's retries of one event.
   */
  async verifyWebhook({ body, signature }): Promise<WebhookVerification> {
    const config = paytmConfig();
    const bad = (error: string): WebhookVerification => ({ ok: false, eventId: null, eventType: null, error });
    if (!config) return bad("Online payment is not set up.");
    let params: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return bad("The callback body was not an object.");
      params = parsed as Record<string, unknown>;
    } catch {
      return bad("The callback body was not JSON.");
    }
    const withHash = signature ? { ...params, CHECKSUMHASH: signature } : params;
    if (typeof withHash.CHECKSUMHASH !== "string") return bad("The callback carried no checksum.");
    if (!verifyCallbackParams(withHash, config.merchantKey)) return bad("The callback checksum did not verify.");
    const { ORDERID, TXNID, STATUS } = params as Record<string, unknown>;
    if (typeof ORDERID !== "string" || typeof TXNID !== "string" || typeof STATUS !== "string") return bad("The callback was missing its order, transaction or status.");
    return { ok: true, eventId: `${ORDERID}:${TXNID}:${STATUS}`, eventType: STATUS };
  },
};

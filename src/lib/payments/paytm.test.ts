import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromRupees, paise } from "@/lib/money";
import { getProvider } from "./index";
import {
  PAYTM_NOT_VERIFIED_MESSAGE,
  PAYTM_PROVIDER,
  PAYTM_SANDBOX_VERIFIED,
  paytmEnvAllowed,
  paytmUnavailableReason,
  callbackChecksumMessage,
  classifyPaytmRefund,
  classifyPaytmRefundFailure,
  composePaymentId,
  fromPaytmAmount,
  generateChecksum,
  isPaytmConfigured,
  paytmProvider,
  splitPaymentId,
  toPaytmAmount,
  verifyCallbackParams,
  verifyChecksum,
} from "./paytm";
import * as fx from "./__fixtures__/paytm";

const AMOUNT = fromRupees("940");
const PAYMENT_ID = composePaymentId(fx.ORDER_ID, fx.TXN_ID);

function configure() {
  vi.stubEnv("PAYTM_MID", fx.TEST_MID);
  vi.stubEnv("PAYTM_MERCHANT_KEY", fx.TEST_KEY);
  vi.stubEnv("PAYTM_WEBSITE_NAME", fx.TEST_WEBSITE);
  vi.stubEnv("PAYTM_ENV", "staging");
  vi.stubEnv("PAYTM_CALLBACK_URL", fx.TEST_CALLBACK);
}

/** A fake fetch that answers with `answer` and records what was sent. Nothing touches the network. */
function fakeFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; body: string }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return answer(String(url), init ?? {});
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
const reply = (body: Record<string, unknown>, status = 200) => new Response(fx.signed(body), { status });

beforeEach(configure);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("checksum", () => {
  // Computed independently with openssl (sha256, then aes-128-cbc with the fixed IV) from the algorithm in
  // Paytm's checksum library. Paytm's docs pages publish no known-answer vector, so this pins our
  // implementation against a second one, not against Paytm. Run Paytm's own sandbox check before go-live.
  const MSG = '{"mid":"TESTMID0000000000001","orderId":"ORDER-1"}';
  const KAT = "gEQS75dBZ2pv9iCCCz3hkGcF5kBzchonNifjOas43vvCboFhwi4HoOfNBu78qfcY/ihaZ7ej1WnYIad0Eag8kVVd3HWenKTKFywmhnuPI4M=";

  it("matches the openssl-computed vector for a fixed salt", () => {
    expect(generateChecksum(MSG, fx.TEST_KEY, "abcd")).toBe(KAT);
    expect(verifyChecksum(MSG, fx.TEST_KEY, KAT)).toBe(true);
  });

  it("round-trips with a random salt, and two checksums of one message differ", () => {
    const a = generateChecksum(MSG, fx.TEST_KEY);
    const b = generateChecksum(MSG, fx.TEST_KEY);
    expect(verifyChecksum(MSG, fx.TEST_KEY, a)).toBe(true);
    expect(verifyChecksum(MSG, fx.TEST_KEY, b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("rejects a changed message, a wrong key, garbage and empty, without throwing", () => {
    expect(verifyChecksum(MSG.replace("ORDER-1", "ORDER-2"), fx.TEST_KEY, KAT)).toBe(false);
    expect(verifyChecksum(MSG, "OtherKey12345678", KAT)).toBe(false);
    expect(verifyChecksum(MSG, fx.TEST_KEY, "not-base64!!")).toBe(false);
    expect(verifyChecksum(MSG, fx.TEST_KEY, "")).toBe(false);
    expect(verifyChecksum(MSG, "short", KAT)).toBe(false);
  });

  it("signs callback fields sorted by key, joined by |, null as empty", () => {
    expect(callbackChecksumMessage({ B: "2", A: "1", C: null, D: "null" })).toBe("1|2||");
  });

  it("verifies a callback and rejects a tampered one", () => {
    const good = { ...fx.callbackFields, CHECKSUMHASH: generateChecksum(callbackChecksumMessage(fx.callbackFields), fx.TEST_KEY) };
    expect(verifyCallbackParams(good, fx.TEST_KEY)).toBe(true);
    expect(verifyCallbackParams({ ...good, TXNAMOUNT: "1.00" }, fx.TEST_KEY)).toBe(false);
    expect(verifyCallbackParams({ ...good, STATUS: "TXN_FAILURE" }, fx.TEST_KEY)).toBe(false);
    const unsigned: Record<string, unknown> = { ...good };
    delete unsigned.CHECKSUMHASH;
    expect(verifyCallbackParams(unsigned, fx.TEST_KEY)).toBe(false);
  });
});

describe("amounts and ids", () => {
  it("writes paise as a two-decimal rupee string and reads it back strictly", () => {
    expect(toPaytmAmount(paise(94_000n))).toBe("940.00");
    expect(toPaytmAmount(paise(3_350n))).toBe("33.50");
    expect(toPaytmAmount(paise(5n))).toBe("0.05");
    expect(() => toPaytmAmount(paise(0n))).toThrow();
    expect(fromPaytmAmount("940.00")).toBe(94_000n);
    expect(fromPaytmAmount("33.5")).toBe(3_350n);
    expect(fromPaytmAmount("940")).toBe(94_000n);
    for (const bad of ["", "-1.00", "1.001", "1e3", "abc", null, undefined, "1,000.00"]) expect(fromPaytmAmount(bad)).toBeNull();
  });

  it("composes and splits the stored payment id", () => {
    expect(splitPaymentId(PAYMENT_ID)).toEqual({ orderId: fx.ORDER_ID, txnId: fx.TXN_ID });
    expect(splitPaymentId(null)).toBeNull();
    expect(splitPaymentId("nocolon")).toBeNull();
    expect(splitPaymentId(":x")).toBeNull();
  });
});

describe("sandbox verification gate", () => {
  it("is not verified yet; flipping it needs the sandbox proof commit", () => {
    expect(PAYTM_SANDBOX_VERIFIED).toBe(false);
  });

  it("allows staging always and production only once verified (all four combinations)", () => {
    expect(paytmEnvAllowed("staging", false)).toBe(true);
    expect(paytmEnvAllowed("staging", true)).toBe(true);
    expect(paytmEnvAllowed("production", false)).toBe(false);
    expect(paytmEnvAllowed("production", true)).toBe(true);
  });

  it("with the real constant: staging is usable, production is refused with the reason", () => {
    expect(isPaytmConfigured()).toBe(true);
    expect(paytmUnavailableReason()).toBeNull();
    vi.stubEnv("PAYTM_ENV", "production");
    expect(isPaytmConfigured()).toBe(false);
    expect(paytmUnavailableReason()).toBe(PAYTM_NOT_VERIFIED_MESSAGE);
    expect(PAYTM_NOT_VERIFIED_MESSAGE).toContain("not verified against Paytm sandbox");
    expect(() => getProvider(PAYTM_PROVIDER)).toThrow(/not verified against Paytm sandbox/);
  });

  it("refuses production without calling Paytm, even with every other value present", async () => {
    vi.stubEnv("PAYTM_ENV", "production");
    const calls = fakeFetch(() => reply(fx.statusSuccess));
    expect((await paytmProvider.capture({ orderId: fx.ORDER_ID, amount: AMOUNT, actorUserId: null, providerPaymentId: fx.TXN_ID, providerOrderId: fx.ORDER_ID })).ok).toBe(false);
    expect((await paytmProvider.refund({ providerPaymentId: PAYMENT_ID, amount: AMOUNT, reason: "x", refundId: "r" })).outcome).toBe("refused");
    await expect(paytmProvider.createIntent({ orderId: fx.ORDER_ID, amount: AMOUNT, method: "UPI" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("configuration", () => {
  it("is not configured, and getProvider refuses it, when anything is missing", () => {
    expect(isPaytmConfigured()).toBe(true);
    expect(getProvider(PAYTM_PROVIDER)).toBe(paytmProvider);
    for (const name of ["PAYTM_MID", "PAYTM_MERCHANT_KEY", "PAYTM_WEBSITE_NAME", "PAYTM_ENV", "PAYTM_CALLBACK_URL"]) {
      vi.stubEnv(name, "");
      expect(isPaytmConfigured(), name).toBe(false);
      configure();
    }
    vi.stubEnv("PAYTM_ENV", "prod");
    expect(isPaytmConfigured()).toBe(false);
    configure();
    vi.stubEnv("PAYTM_MERCHANT_KEY", "too-short");
    expect(isPaytmConfigured()).toBe(false);
    expect(() => getProvider(PAYTM_PROVIDER)).toThrow("not configured");
  });

  it("does nothing with an unconfigured provider", async () => {
    vi.stubEnv("PAYTM_MID", "");
    const calls = fakeFetch(() => reply({}));
    expect((await paytmProvider.capture({ orderId: fx.ORDER_ID, amount: AMOUNT, actorUserId: null, providerPaymentId: PAYMENT_ID })).ok).toBe(false);
    expect((await paytmProvider.refund({ providerPaymentId: PAYMENT_ID, amount: AMOUNT, reason: "x", refundId: "r1" })).outcome).toBe("refused");
    await expect(paytmProvider.createIntent({ orderId: fx.ORDER_ID, amount: AMOUNT, method: "UPI" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("createIntent", () => {
  it("opens the transaction for the server's amount and is byte-identical on a retry", async () => {
    const calls = fakeFetch(() => reply(fx.initiateOk));
    const first = await paytmProvider.createIntent({ orderId: fx.ORDER_ID, amount: AMOUNT, method: "UPI" });
    const second = await paytmProvider.createIntent({ orderId: fx.ORDER_ID, amount: AMOUNT, method: "UPI" });
    expect(first).toMatchObject({ orderId: fx.ORDER_ID, providerOrderId: fx.ORDER_ID, requiresCustomerAction: true });
    expect(second).toEqual(first);
    expect(calls[0]?.url).toContain("securegw-stage.paytm.in/theia/api/v1/initiateTransaction");
    expect(calls[0]?.url).toContain(`orderId=${fx.ORDER_ID}`);
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.body).toMatchObject({ requestType: "Payment", mid: fx.TEST_MID, orderId: fx.ORDER_ID, txnAmount: { value: "940.00", currency: "INR" }, websiteName: fx.TEST_WEBSITE, callbackUrl: fx.TEST_CALLBACK });
    // The request is signed over exactly its body, and the retry differs only in the random salt.
    expect(verifyChecksum(JSON.stringify(sent.body), fx.TEST_KEY, sent.head.signature)).toBe(true);
    expect(JSON.parse(calls[1]?.body ?? "{}").body).toEqual(sent.body);
  });

  it("throws on a rejected initiate, an unsigned answer, and a bad order id, never returning an intent", async () => {
    fakeFetch(() => reply(fx.initiateRejected));
    await expect(paytmProvider.createIntent({ orderId: fx.ORDER_ID, amount: AMOUNT, method: "UPI" })).rejects.toThrow("could not start");
    fakeFetch(() => new Response(JSON.stringify({ body: fx.initiateOk }), { status: 200 }));
    await expect(paytmProvider.createIntent({ orderId: fx.ORDER_ID, amount: AMOUNT, method: "UPI" })).rejects.toThrow();
    fakeFetch(() => new Response(fx.signed(fx.initiateOk, "OtherKey12345678"), { status: 200 }));
    await expect(paytmProvider.createIntent({ orderId: fx.ORDER_ID, amount: AMOUNT, method: "UPI" })).rejects.toThrow("did not verify");
    await expect(paytmProvider.createIntent({ orderId: "bad id!", amount: AMOUNT, method: "UPI" })).rejects.toThrow();
  });
});

describe("capture (Transaction Status is the authority)", () => {
  const input = { orderId: fx.ORDER_ID, amount: AMOUNT, actorUserId: null, providerPaymentId: fx.TXN_ID, providerOrderId: fx.ORDER_ID };

  it("captures a verified TXN_SUCCESS for our order and amount", async () => {
    const calls = fakeFetch(() => reply(fx.statusSuccess));
    const r = await paytmProvider.capture(input);
    expect(r).toMatchObject({ ok: true, providerPaymentId: PAYMENT_ID, capturedAmount: AMOUNT });
    expect(r.payload).toMatchObject({ method: "UPI", verifiedBy: "status-api" });
    expect(JSON.parse(calls[0]?.body ?? "{}").body).toEqual({ mid: fx.TEST_MID, orderId: fx.ORDER_ID });
  });

  it("rejects an amount mismatch as a verified decline", async () => {
    fakeFetch(() => reply({ ...fx.statusSuccess, txnAmount: "1.00" }));
    expect(await paytmProvider.capture(input)).toMatchObject({ ok: false, code: "GATEWAY_DECLINED", capturedAmount: 0n, payload: { gatewayVerified: true } });
  });

  it("rejects a different order id and a different transaction id", async () => {
    fakeFetch(() => reply({ ...fx.statusSuccess, orderId: "OTHER" }));
    expect(await paytmProvider.capture(input)).toMatchObject({ ok: false, code: "GATEWAY_DECLINED" });
    fakeFetch(() => reply({ ...fx.statusSuccess, txnId: "different-txn" }));
    expect(await paytmProvider.capture(input)).toMatchObject({ ok: false, code: "GATEWAY_DECLINED" });
  });

  it("refuses before asking when the order ids disagree or none is given", async () => {
    const calls = fakeFetch(() => reply(fx.statusSuccess));
    expect(await paytmProvider.capture({ ...input, providerOrderId: "OTHER" })).toMatchObject({ ok: false, code: "UNVERIFIED" });
    expect(await paytmProvider.capture({ ...input, providerOrderId: undefined })).toMatchObject({ ok: false, code: "UNVERIFIED" });
    expect(calls).toHaveLength(0);
  });

  it("maps failure to final and pending, no record, unknown and errors to retryable, never ok", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [fx.statusFailure, "GATEWAY_DECLINED"],
      [fx.statusPending, "GATEWAY_UNAVAILABLE"],
      [fx.statusNoRecord, "GATEWAY_UNAVAILABLE"],
      [fx.statusUnknown, "GATEWAY_UNAVAILABLE"],
      [{ ...fx.statusSuccess, txnId: "" }, "GATEWAY_UNAVAILABLE"],
    ];
    for (const [body, code] of cases) {
      fakeFetch(() => reply(body));
      const r = await paytmProvider.capture(input);
      expect(r.ok).toBe(false);
      expect(r.code).toBe(code);
    }
    for (const bad of [() => new Response("", { status: 500 }), () => new Response("", { status: 401 }), () => new Response("not json", { status: 200 })]) {
      fakeFetch(bad);
      expect(await paytmProvider.capture(input)).toMatchObject({ ok: false, code: "GATEWAY_UNAVAILABLE" });
    }
    fakeFetch(() => {
      throw new Error("offline");
    });
    expect(await paytmProvider.capture(input)).toMatchObject({ ok: false, code: "GATEWAY_UNAVAILABLE" });
  });

  it("does not believe a TXN_SUCCESS whose signature is wrong (a tampered answer)", async () => {
    fakeFetch(() => new Response(fx.signed(fx.statusSuccess, "OtherKey12345678"), { status: 200 }));
    expect(await paytmProvider.capture(input)).toMatchObject({ ok: false, code: "GATEWAY_UNAVAILABLE" });
    fakeFetch(() => {
      const env = JSON.parse(fx.signed(fx.statusFailure));
      env.body = fx.statusSuccess; // body swapped after signing
      return new Response(JSON.stringify(env), { status: 200 });
    });
    expect((await paytmProvider.capture(input)).ok).toBe(false);
  });
});

describe("refund", () => {
  const ask = () => paytmProvider.refund({ providerPaymentId: PAYMENT_ID, amount: AMOUNT, reason: "Customer cancelled", refundId: "refund-row-1" });

  it("sends our row id as refId, the amount as rupees, and succeeds on a matching TXN_SUCCESS", async () => {
    const calls = fakeFetch(() => reply(fx.refundSuccess));
    expect(await ask()).toMatchObject({ outcome: "succeeded", refundedAmount: AMOUNT, providerRefundId: "fake-paytm-refund-1", httpStatus: 200 });
    expect(calls[0]?.url).toContain("securestage.paytmpayments.com/refund/apply");
    expect(JSON.parse(calls[0]?.body ?? "{}").body).toEqual({ mid: fx.TEST_MID, txnType: "REFUND", orderId: fx.ORDER_ID, txnId: fx.TXN_ID, refId: "refund-row-1", refundAmount: "940.00", comments: "Customer cancelled" });
  });

  it("repeats byte-identically, so a retry is the same refund", async () => {
    const calls = fakeFetch(() => reply(fx.refundPending));
    await ask();
    await ask();
    expect(JSON.parse(calls[0]?.body ?? "{}").body).toEqual(JSON.parse(calls[1]?.body ?? "{}").body);
  });

  it("maps pending, refused and a different amount", async () => {
    fakeFetch(() => reply(fx.refundPending));
    expect((await ask()).outcome).toBe("pending");
    fakeFetch(() => reply(fx.refundRefused));
    expect((await ask()).outcome).toBe("refused");
    fakeFetch(() => reply({ ...fx.refundSuccess, refundAmount: "1.00" }));
    expect(await ask()).toMatchObject({ outcome: "ambiguous", refundedAmount: 0n });
    fakeFetch(() => reply({ ...fx.refundSuccess, refundAmount: undefined }));
    expect((await ask()).outcome).toBe("ambiguous");
  });

  it("treats a duplicate or already-successful code as ambiguous, not a refusal", async () => {
    fakeFetch(() => reply(fx.refundDuplicate));
    expect((await ask()).outcome).toBe("ambiguous");
    expect(classifyPaytmRefund({ resultInfo: { resultStatus: "TXN_SUCCESS", resultCode: "629" } }, AMOUNT, 200).outcome).toBe("ambiguous");
  });

  it("is retryable (ambiguous) on 5xx, 429, 409, a timeout and a bad signature; refused on another 4xx", async () => {
    for (const status of [500, 502, 429, 409, 408]) {
      fakeFetch(() => new Response("", { status }));
      expect((await ask()).outcome, String(status)).toBe("ambiguous");
    }
    fakeFetch(() => {
      throw new Error("timeout");
    });
    expect((await ask()).outcome).toBe("ambiguous");
    fakeFetch(() => new Response(fx.signed(fx.refundSuccess, "OtherKey12345678"), { status: 200 }));
    expect((await ask()).outcome).toBe("ambiguous");
    fakeFetch(() => new Response("", { status: 400 }));
    expect((await ask()).outcome).toBe("refused");
    expect(classifyPaytmRefundFailure("x", 404).outcome).toBe("refused");
    expect(classifyPaytmRefundFailure("x", null).outcome).toBe("ambiguous");
  });

  it("does not ask Paytm when there is no payment to refund", async () => {
    const calls = fakeFetch(() => reply(fx.refundSuccess));
    expect((await paytmProvider.refund({ providerPaymentId: null, amount: AMOUNT, reason: "x", refundId: "r" })).outcome).toBe("refused");
    expect((await paytmProvider.refund({ providerPaymentId: "no-colon", amount: AMOUNT, reason: "x", refundId: "r" })).outcome).toBe("refused");
    expect(calls).toHaveLength(0);
  });
});

describe("findRefund", () => {
  const find = () => paytmProvider.findRefund?.({ providerPaymentId: PAYMENT_ID, refundId: "refund-row-1" });

  it("finds a succeeded, a pending and a refused refund, and reports no record as not found", async () => {
    const calls = fakeFetch(() => reply(fx.refundSuccess));
    expect(await find()).toMatchObject({ found: true, result: { outcome: "succeeded", refundedAmount: AMOUNT } });
    expect(JSON.parse(calls[0]?.body ?? "{}").body).toEqual({ mid: fx.TEST_MID, orderId: fx.ORDER_ID, refId: "refund-row-1" });
    fakeFetch(() => reply(fx.refundPending));
    expect(await find()).toMatchObject({ found: true, result: { outcome: "pending" } });
    fakeFetch(() => reply(fx.refundRefused));
    expect(await find()).toMatchObject({ found: true, result: { outcome: "refused" } });
    fakeFetch(() => reply(fx.refundNoRecord));
    expect(await find()).toEqual({ found: false });
  });

  it("is unknown, never not-found, when it could not be answered", async () => {
    fakeFetch(() => new Response("", { status: 500 }));
    expect(await find()).toMatchObject({ found: "unknown" });
    fakeFetch(() => reply({ ...fx.refundSuccess, refundAmount: undefined }));
    expect(await find()).toMatchObject({ found: "unknown" });
  });
});

describe("verifyWebhook", () => {
  const hash = (fields: Record<string, unknown>) => generateChecksum(callbackChecksumMessage(fields), fx.TEST_KEY);

  it("accepts a correctly signed callback and names a stable event id", async () => {
    const body = JSON.stringify({ ...fx.callbackFields, CHECKSUMHASH: hash(fx.callbackFields) });
    expect(await paytmProvider.verifyWebhook({ body, signature: null })).toEqual({ ok: true, eventId: `${fx.ORDER_ID}:${fx.TXN_ID}:TXN_SUCCESS`, eventType: "TXN_SUCCESS" });
    const viaHeader = JSON.stringify(fx.callbackFields);
    expect((await paytmProvider.verifyWebhook({ body: viaHeader, signature: hash(fx.callbackFields) })).ok).toBe(true);
  });

  it("rejects tampering, no checksum, bad JSON and non-objects", async () => {
    const tampered = JSON.stringify({ ...fx.callbackFields, TXNAMOUNT: "1.00", CHECKSUMHASH: hash(fx.callbackFields) });
    expect((await paytmProvider.verifyWebhook({ body: tampered, signature: null })).ok).toBe(false);
    expect((await paytmProvider.verifyWebhook({ body: JSON.stringify(fx.callbackFields), signature: null })).ok).toBe(false);
    expect((await paytmProvider.verifyWebhook({ body: "not json", signature: "x" })).ok).toBe(false);
    expect((await paytmProvider.verifyWebhook({ body: "[]", signature: "x" })).ok).toBe(false);
    const noStatus = { ORDERID: "o", TXNID: "t" };
    expect((await paytmProvider.verifyWebhook({ body: JSON.stringify({ ...noStatus, CHECKSUMHASH: hash(noStatus) }), signature: null })).ok).toBe(false);
  });
});

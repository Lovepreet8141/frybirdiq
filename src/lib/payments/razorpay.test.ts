import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromRupees, paise } from "@/lib/money";
import { availableMethods, codAllowed, COD_CAP, getProvider } from "./index";
import {
  RAZORPAY_PROVIDER,
  isRazorpayConfigured,
  methodFromRazorpay,
  RAZORPAY_TIMEOUT_MS,
  REFUND_ROW_NOTE,
  classifyRazorpayRefund,
  classifyRazorpayRefundFailure,
  paymentSignature,
  razorpayProvider,
  refundRequestBody,
  toRazorpayAmount,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpay";

/*
 * Recorded fixture. The key secret is a throwaway test value; `signature` is
 * what Razorpay Checkout returns for this order/payment pair under it
 * (HMAC-SHA256 of "order_id|payment_id"), computed once with node's crypto
 * and pinned here so a change to the algorithm, the separator or the
 * encoding fails loudly. `forged` is the same length and alphabet, wrong.
 */
const FIXTURE = {
  keySecret: "test_secret_frybird_0001",
  orderId: "order_MkXq7bZ2Qw9nLp",
  paymentId: "pay_MkXr1cD4Rt8vGh",
  signature: "04dc1869684abe125007b3d6a7dc36cd1d0a08fde0aac81fd37fe7922d1f5904",
  forged: "8d6c9d7b8c5f5b2b4e9f2a0c3d6e1f7a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e",
};

describe("razorpay signatures", () => {
  it("signs order_id|payment_id with the key secret", () => {
    const signature = paymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, keySecret: FIXTURE.keySecret });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(FIXTURE.signature);
  });

  it("accepts the genuine signature and rejects a forged one", () => {
    const genuine = paymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, keySecret: FIXTURE.keySecret });
    expect(verifyPaymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, signature: genuine, keySecret: FIXTURE.keySecret })).toBe(true);
    expect(verifyPaymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, signature: genuine.toUpperCase(), keySecret: FIXTURE.keySecret })).toBe(true);
    expect(verifyPaymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, signature: FIXTURE.forged, keySecret: FIXTURE.keySecret })).toBe(false);
    expect(verifyPaymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: "pay_other", signature: genuine, keySecret: FIXTURE.keySecret })).toBe(false);
    expect(verifyPaymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, signature: genuine, keySecret: "wrong" })).toBe(false);
  });

  it("refuses an empty or malformed signature without throwing", () => {
    expect(verifyPaymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, signature: "", keySecret: FIXTURE.keySecret })).toBe(false);
    expect(verifyPaymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, signature: "zz".repeat(32), keySecret: FIXTURE.keySecret })).toBe(false);
  });

  it("verifies a webhook over the raw body", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: FIXTURE.paymentId } } } });
    const signature = createHmac("sha256", "whsec_test").update(body).digest("hex");
    expect(verifyWebhookSignature({ body, signature, webhookSecret: "whsec_test" })).toBe(true);
    expect(verifyWebhookSignature({ body: body + " ", signature, webhookSecret: "whsec_test" })).toBe(false);
    expect(verifyWebhookSignature({ body, signature, webhookSecret: "whsec_other" })).toBe(false);
  });
});

describe("razorpay amounts and methods", () => {
  it("sends integer paise and refuses zero", () => {
    expect(toRazorpayAmount(fromRupees("299"))).toBe(29900);
    expect(toRazorpayAmount(paise(1))).toBe(1);
    expect(() => toRazorpayAmount(paise(0))).toThrow(RangeError);
  });

  it("maps Razorpay's method names onto ours", () => {
    expect(methodFromRazorpay("upi")).toBe("UPI");
    expect(methodFromRazorpay("card")).toBe("CARD");
    expect(methodFromRazorpay("netbanking")).toBe("NETBANKING");
    expect(methodFromRazorpay("wallet")).toBe("WALLET");
    expect(methodFromRazorpay("emi")).toBe("OTHER");
    expect(methodFromRazorpay(undefined)).toBe("OTHER");
  });
});

describe("razorpay availability", () => {
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  beforeEach(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });
  afterEach(() => {
    if (saved.id !== undefined) process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret !== undefined) process.env.RAZORPAY_KEY_SECRET = saved.secret;
  });

  it("is off, and cash-only, without keys", () => {
    expect(isRazorpayConfigured()).toBe(false);
    expect(availableMethods().map((m) => m.choice)).toEqual(["COD"]);
    expect(() => getProvider(RAZORPAY_PROVIDER)).toThrow(/not configured/);
  });

  it("offers online first once keys exist", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "s";
    expect(isRazorpayConfigured()).toBe(true);
    expect(availableMethods().map((m) => m.choice)).toEqual(["ONLINE", "COD"]);
    expect(getProvider(RAZORPAY_PROVIDER).name).toBe("razorpay");
  });

  it("capture refuses without keys rather than pretending", async () => {
    const result = await razorpayProvider.capture({ orderId: "o", amount: fromRupees("1"), actorUserId: null, providerPaymentId: "pay_x", providerOrderId: "order_x", signature: "00" });
    expect(result.ok).toBe(false);
  });

  it("capture verifies the signature before it ever calls Razorpay", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = FIXTURE.keySecret;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await razorpayProvider.capture({
      orderId: "o",
      amount: fromRupees("1"),
      actorUserId: null,
      providerPaymentId: FIXTURE.paymentId,
      providerOrderId: FIXTURE.orderId,
      signature: FIXTURE.forged,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/signature/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    [401, "our key pair was refused"],
    [403, "our key pair was refused"],
    [408, "the request timed out"],
    [429, "throttled"],
    [500, "the gateway failed"],
    [503, "the gateway failed"],
  ])("a %i from Razorpay's payment fetch (%s) stays retryable: GATEWAY_UNAVAILABLE, never a final decline", async (status) => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = FIXTURE.keySecret;
    const genuine = paymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, keySecret: FIXTURE.keySecret });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { description: "x" } }), { status }));
    const result = await razorpayProvider.capture({ orderId: "o", amount: fromRupees("299"), actorUserId: null, providerPaymentId: FIXTURE.paymentId, providerOrderId: FIXTURE.orderId, signature: genuine });
    expect(result).toMatchObject({ ok: false, code: "GATEWAY_UNAVAILABLE" });
    fetchSpy.mockRestore();
  });

  it("a 404 for THIS payment is Razorpay's own answer and stays a final decline", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = FIXTURE.keySecret;
    const genuine = paymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, keySecret: FIXTURE.keySecret });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { description: "not found" } }), { status: 404 }));
    const result = await razorpayProvider.capture({ orderId: "o", amount: fromRupees("299"), actorUserId: null, providerPaymentId: FIXTURE.paymentId, providerOrderId: FIXTURE.orderId, signature: genuine });
    expect(result).toMatchObject({ ok: false, code: "GATEWAY_DECLINED" });
    fetchSpy.mockRestore();
  });

  it("capture checks the amount Razorpay holds against the order", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = FIXTURE.keySecret;
    const genuine = paymentSignature({ providerOrderId: FIXTURE.orderId, providerPaymentId: FIXTURE.paymentId, keySecret: FIXTURE.keySecret });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: FIXTURE.paymentId, order_id: FIXTURE.orderId, amount: 29900, currency: "INR", status: "captured", method: "upi", fee: 590, tax: 90 }), { status: 200 }),
    );
    const short = await razorpayProvider.capture({ orderId: "o", amount: fromRupees("300"), actorUserId: null, providerPaymentId: FIXTURE.paymentId, providerOrderId: FIXTURE.orderId, signature: genuine });
    expect(short.ok).toBe(false);
    expect(short.error).toMatch(/does not match/);

    const exact = await razorpayProvider.capture({ orderId: "o", amount: fromRupees("299"), actorUserId: null, providerPaymentId: FIXTURE.paymentId, providerOrderId: FIXTURE.orderId, signature: genuine });
    expect(exact.ok).toBe(true);
    expect(exact.capturedAmount).toBe(fromRupees("299"));
    expect(exact.payload?.method).toBe("UPI");
    expect(exact.payload?.fee).toBe(590);
    fetchSpy.mockRestore();
  });
});

describe("cash on delivery cap", () => {
  it("caps COD at ₹1,500 only when online payment exists", () => {
    expect(COD_CAP).toBe(fromRupees("1500"));
    expect(codAllowed(fromRupees("1500"), true).ok).toBe(true);
    expect(codAllowed(fromRupees("1500.01"), true).ok).toBe(false);
    expect(codAllowed(fromRupees("4000"), false).ok).toBe(true);
  });

  it("reads a cap the caller passes — the org's own `cod_cap`, roadmap 5.5 — instead of the constant", () => {
    expect(codAllowed(fromRupees("4000"), true, fromRupees("5000")).ok).toBe(true);
    expect(codAllowed(fromRupees("5000.01"), true, fromRupees("5000")).ok).toBe(false);
  });
});

/*
 * Refunds (refund design Revision 2, slice 2). Recorded response shapes from
 * razorpay.com/docs/api/refunds — no network: fetch is stubbed per test.
 */
describe("razorpay refunds", () => {
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const REFUND_ROW = "0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f";
  const refundObject = (over: Record<string, unknown> = {}) => ({
    id: "rfnd_FP8QHiV938haTz",
    entity: "refund",
    amount: 29900,
    currency: "INR",
    payment_id: FIXTURE.paymentId,
    notes: { reason: "Wrong order", [REFUND_ROW_NOTE]: REFUND_ROW },
    status: "processed",
    ...over,
  });

  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = FIXTURE.keySecret;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = saved.secret;
  });

  it("sends the refund row id as X-Refund-Idempotency and in the notes, with a byte-identical body on a repeat", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(refundObject()), { status: 200 }));
    const input = { providerPaymentId: FIXTURE.paymentId, amount: fromRupees("299"), reason: "Wrong order", refundId: REFUND_ROW };

    const first = await razorpayProvider.refund(input);
    const second = await razorpayProvider.refund(input);

    expect(first).toEqual({ outcome: "succeeded", providerRefundId: "rfnd_FP8QHiV938haTz", refundedAmount: fromRupees("299"), httpStatus: 200 });
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`https://api.razorpay.com/v1/payments/${FIXTURE.paymentId}/refund`);
    expect((init?.headers as Record<string, string>)["X-Refund-Idempotency"]).toBe(REFUND_ROW);
    expect(JSON.parse(String(init?.body))).toEqual({ amount: 29900, notes: { reason: "Wrong order", [REFUND_ROW_NOTE]: REFUND_ROW } });
    expect(fetchSpy.mock.calls[1]![1]?.body).toBe(init?.body);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(RAZORPAY_TIMEOUT_MS).toBeLessThan(10_000); // below withIdempotency's in-flight wait (RELIABILITY C3)
  });

  it("keeps a pending refund pending (it must stay RESERVED), and refuses a failed one", () => {
    expect(classifyRazorpayRefund(refundObject({ status: "pending" }) as never, fromRupees("299"), 200).outcome).toBe("pending");
    expect(classifyRazorpayRefund(refundObject({ status: "failed" }) as never, fromRupees("299"), 200).outcome).toBe("refused");
    expect(classifyRazorpayRefund(refundObject({ status: "something_new" }) as never, fromRupees("299"), 200).outcome).toBe("ambiguous");
  });

  it("never books a processed refund for a different amount than was asked (S7)", () => {
    const short = classifyRazorpayRefund(refundObject({ amount: 20000 }) as never, fromRupees("299"), 200);
    expect(short.outcome).toBe("ambiguous");
    expect(short.refundedAmount).toBe(paise(0));
  });

  it.each([
    [400, "refused"],
    [401, "refused"],
    [404, "refused"],
    [409, "ambiguous"],
    [429, "ambiguous"],
    [500, "ambiguous"],
    [503, "ambiguous"],
    [null, "ambiguous"],
  ] as const)("classifies a failed call with HTTP %s as %s", (status, outcome) => {
    expect(classifyRazorpayRefundFailure("x", status).outcome).toBe(outcome);
  });

  it("treats a 409 on the same key (in progress, or another body) as ambiguous, never a fresh refusal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: "Another request with the same idempotency key is still in progress." } }), { status: 409 }),
    );
    const result = await razorpayProvider.refund({ providerPaymentId: FIXTURE.paymentId, amount: fromRupees("299"), reason: "Wrong order", refundId: REFUND_ROW });
    expect(result.outcome).toBe("ambiguous");
    expect(result.httpStatus).toBe(409);
  });

  it("treats a network error or a timeout as ambiguous", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const result = await razorpayProvider.refund({ providerPaymentId: FIXTURE.paymentId, amount: fromRupees("299"), reason: "Wrong order", refundId: REFUND_ROW });
    expect(result).toMatchObject({ outcome: "ambiguous", httpStatus: null });
  });

  it("refuses without sending anything when there are no keys or no payment id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await razorpayProvider.refund({ providerPaymentId: null, amount: fromRupees("1"), reason: "x", refundId: REFUND_ROW })).outcome).toBe("refused");
    delete process.env.RAZORPAY_KEY_ID;
    expect((await razorpayProvider.refund({ providerPaymentId: FIXTURE.paymentId, amount: fromRupees("1"), reason: "x", refundId: REFUND_ROW })).outcome).toBe("refused");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("finds an earlier refund by the row id in its notes, and only that one", async () => {
    const other = refundObject({ id: "rfnd_other", notes: { [REFUND_ROW_NOTE]: "another-row" } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ entity: "collection", count: 2, items: [other, refundObject({ status: "pending" })] }), { status: 200 }),
    );
    const found = await razorpayProvider.findRefund!({ providerPaymentId: FIXTURE.paymentId, refundId: REFUND_ROW });
    expect(found).toMatchObject({ found: true, result: { outcome: "pending", providerRefundId: "rfnd_FP8QHiV938haTz" } });
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`https://api.razorpay.com/v1/payments/${FIXTURE.paymentId}/refunds?count=100`);
    expect(fetchSpy.mock.calls[0]![1]?.method).toBe("GET");

    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ entity: "collection", count: 1, items: [other] }), { status: 200 }));
    expect(await razorpayProvider.findRefund!({ providerPaymentId: FIXTURE.paymentId, refundId: REFUND_ROW })).toEqual({ found: false });

    fetchSpy.mockImplementation(async () => new Response("", { status: 502 }));
    expect((await razorpayProvider.findRefund!({ providerPaymentId: FIXTURE.paymentId, refundId: REFUND_ROW })).found).toBe("unknown");
  });

  it("builds the request only from the reserved row's own fields", () => {
    expect(refundRequestBody({ amount: fromRupees("150.50"), reason: "x".repeat(300), refundId: REFUND_ROW })).toEqual({
      amount: 15050,
      notes: { reason: "x".repeat(250), [REFUND_ROW_NOTE]: REFUND_ROW },
    });
  });
});

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromRupees, paise } from "@/lib/money";
import { availableMethods, codAllowed, COD_CAP, getProvider } from "./index";
import {
  RAZORPAY_PROVIDER,
  isRazorpayConfigured,
  methodFromRazorpay,
  paymentSignature,
  razorpayProvider,
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
});

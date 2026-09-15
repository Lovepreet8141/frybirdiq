import { describe, expect, it } from "vitest";
import { ZERO, fromRupees } from "@/lib/money";
import { CASH_PROVIDER, availableMethods, cashProvider, getProvider } from "./index";
import { UnsupportedByProvider } from "./provider";

describe("provider registry", () => {
  it("resolves cash by name", () => {
    expect(getProvider(CASH_PROVIDER).name).toBe("cash");
  });

  it("refuses an unknown provider rather than falling back", () => {
    // A silent fallback would let a typo route real money through cash.
    expect(() => getProvider("paytm")).toThrow(/no provider named/);
  });

  it("offers only cash without gateway keys", () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const methods = availableMethods();
    expect(methods).toHaveLength(1);
    expect(methods[0]!.method).toBe("CASH");
    expect(methods[0]!.provider).toBe(CASH_PROVIDER);
  });

  it("the business's own toggle (roadmap 5.5) can turn cash off even with no gateway", () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(availableMethods({ cash: false })).toHaveLength(0);
  });

  it("the toggle can turn online off even when Razorpay is configured", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "s";
    try {
      expect(availableMethods({ online: false }).map((m) => m.choice)).toEqual(["COD"]);
      expect(availableMethods().map((m) => m.choice)).toEqual(["ONLINE", "COD"]);
    } finally {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
    }
  });
});

describe("cash intent", () => {
  it("needs nothing from the customer", async () => {
    const intent = await cashProvider.createIntent({
      orderId: "order-1",
      amount: fromRupees("299"),
      method: "CASH",
    });
    expect(intent.requiresCustomerAction).toBe(false);
    expect(intent.amount).toBe(fromRupees("299"));
  });

  it("carries no provider reference, rather than a fabricated one", () => {
    // A made-up reference would make a settlement report look reconcilable
    // when there is nothing on the other side to reconcile against.
    return expect(
      cashProvider
        .createIntent({ orderId: "order-1", amount: fromRupees("299"), method: "CASH" })
        .then((intent) => intent.providerOrderId),
    ).resolves.toBeNull();
  });
});

describe("cash capture", () => {
  it("records the money against the person who took it", async () => {
    const result = await cashProvider.capture({
      orderId: "order-1",
      amount: fromRupees("299"),
      actorUserId: "staff-1",
    });
    expect(result.ok).toBe(true);
    expect(result.capturedAmount).toBe(fromRupees("299"));
    expect(result.payload?.takenBy).toBe("staff-1");
  });

  it("refuses to book cash anonymously", async () => {
    // Cash has no gateway record and no bank entry until the till is banked.
    // Knowing who took it is the only accountability there is.
    const result = await cashProvider.capture({
      orderId: "order-1",
      amount: fromRupees("299"),
      actorUserId: null,
    });
    expect(result.ok).toBe(false);
    expect(result.capturedAmount).toBe(ZERO);
    expect(result.error).toMatch(/member of staff/);
  });

  it("refuses a zero or negative amount", async () => {
    for (const amount of [ZERO, fromRupees("-50")]) {
      const result = await cashProvider.capture({ orderId: "order-1", amount, actorUserId: "staff-1" });
      expect(result.ok).toBe(false);
    }
  });
});

describe("cash refund", () => {
  it("returns the amount taken back out of the till", async () => {
    const result = await cashProvider.refund({
      providerPaymentId: null,
      amount: fromRupees("299"),
      reason: "Wrong order",
    });
    expect(result.ok).toBe(true);
    expect(result.refundedAmount).toBe(fromRupees("299"));
  });
});

describe("cash webhooks", () => {
  it("throws rather than reporting an unverified result", async () => {
    // Returning { ok: false } would let a caller treat a forged callback as
    // merely unsigned. Nothing calls back about cash at all.
    await expect(cashProvider.verifyWebhook({ body: "{}", signature: null })).rejects.toThrow(UnsupportedByProvider);
  });
});

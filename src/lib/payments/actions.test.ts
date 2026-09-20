/**
 * confirmOnlinePaymentAction and reportOnlinePaymentFailureAction — the
 * customer's side of paying online (pay-ready).
 *
 * No staff session and no amount: the only authority is Razorpay's signature
 * and its own record, both checked by recordOnlinePayment. The action must
 * forward exactly the ids and signature, never anything that sets money or
 * status, and refuse malformed input without touching the database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordOnlinePayment = vi.fn();
const markOnlinePaymentFailed = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/repositories/payments", () => ({
  recordOnlinePayment: (input: unknown) => recordOnlinePayment(input),
  markOnlinePaymentFailed: (input: unknown) => markOnlinePaymentFailed(input),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock("@/lib/customer", () => ({ getCustomer: async () => null }));
vi.mock("@/lib/cart/remembered-contact", () => ({ readRememberedContact: async () => ({ phone: "9876543210" }) }));

const { confirmOnlinePaymentAction, reportOnlinePaymentFailureAction } = await import("./actions");

const ORDER = "4b3a2c1d-0e0f-4a1b-8c2d-3e4f5a6b7c8d";
const VALID = { orderId: ORDER, razorpayOrderId: "order_Abc123", razorpayPaymentId: "pay_Xyz789", razorpaySignature: "a".repeat(64) };

describe("confirmOnlinePaymentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["not an object", "nope"],
    ["an order id that is not a UUID", { ...VALID, orderId: "1" }],
    ["a signature that is not 64 hex", { ...VALID, razorpaySignature: "zz" }],
    ["a missing payment id", { ...VALID, razorpayPaymentId: "" }],
  ])("refuses %s without asking the repository", async (_label, input) => {
    const result = await confirmOnlinePaymentAction(input);
    expect(result.ok).toBe(false);
    expect(recordOnlinePayment).not.toHaveBeenCalled();
  });

  it("forwards exactly the ids and the signature — an amount or a status in the input goes nowhere", async () => {
    recordOnlinePayment.mockResolvedValue({ ok: true, paymentId: "p-1", replayed: false });
    const result = await confirmOnlinePaymentAction({ ...VALID, amount: 1, status: "PAID", grandTotal: "1" });
    expect(result).toEqual({ ok: true, replayed: false });
    expect(recordOnlinePayment).toHaveBeenCalledWith({ orderId: ORDER, providerPaymentId: "pay_Xyz789", providerOrderId: "order_Abc123", signature: "a".repeat(64) });
    expect(revalidatePath).toHaveBeenCalledWith(`/order/${ORDER}`);
  });

  it("reports a replay as a replay (the webhook got there first)", async () => {
    recordOnlinePayment.mockResolvedValue({ ok: true, paymentId: "p-1", replayed: true });
    expect(await confirmOnlinePaymentAction(VALID)).toEqual({ ok: true, replayed: true });
  });

  it("passes the server's refusal through — including money recorded for a refund", async () => {
    recordOnlinePayment.mockResolvedValue({ ok: false, code: "RECORDED_FOR_REFUND", error: "This order had already been paid or closed, so this payment has been recorded to be refunded.", paymentId: "p-2" });
    expect(await confirmOnlinePaymentAction(VALID)).toEqual({ ok: false, code: "RECORDED_FOR_REFUND", error: "This order had already been paid or closed, so this payment has been recorded to be refunded." });
  });
});

describe("reportOnlinePaymentFailureAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws the client's reason away and binds the report to this device's phone", async () => {
    markOnlinePaymentFailed.mockResolvedValue({ ok: true });
    await reportOnlinePaymentFailureAction({ orderId: ORDER, reason: "Your order was cancelled, call 0000" });
    expect(markOnlinePaymentFailed).toHaveBeenCalledWith({ orderId: ORDER, via: { kind: "customer", customerId: null, phone: "9876543210" } });
  });

  it("refuses a malformed order id without asking the repository", async () => {
    expect(await reportOnlinePaymentFailureAction({ orderId: "x" })).toEqual({ ok: false });
    expect(markOnlinePaymentFailed).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  advanceOrder: vi.fn(),
  completeDelivery: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  NotSignedIn: class NotSignedIn extends Error {},
  NotPermitted: class NotPermitted extends Error {},
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/repositories/orders", () => ({
  acceptOrder: vi.fn(),
  advanceOrder: mocks.advanceOrder,
  completeDelivery: mocks.completeDelivery,
  rejectOrder: vi.fn(),
}));
vi.mock("@/lib/repositories/payments", () => ({ recordCashPayment: vi.fn() }));

import { NotPermitted, NotSignedIn } from "@/lib/auth";
import { advanceOrderAction, completeDeliveryAction } from "./staff-actions";

const orderId = "7d9f2c1e-4b3a-4c5d-8e6f-1a2b3c4d5e6f";
const staff = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222", roles: ["CASHIER"] };

describe("advanceOrderAction", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue(staff);
    mocks.advanceOrder.mockReset().mockResolvedValue({ ok: true });
  });

  it.each(["CANCELLED", "REFUNDED", "PAID", "DRAFT", "PENDING_PAYMENT", "FAILED"] as const)(
    "refuses %s before any permission check or database call",
    async (to) => {
      const result = await advanceOrderAction({ orderId, to });
      expect(result).toEqual({ ok: false, error: "That change could not be applied." });
      expect(mocks.requirePermission).not.toHaveBeenCalled();
      expect(mocks.advanceOrder).not.toHaveBeenCalled();
    },
  );

  it("still moves a ticket forward with kitchen.update, scoped to the staff member's org", async () => {
    const result = await advanceOrderAction({ orderId, to: "READY" });
    expect(result).toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("kitchen.update");
    expect(mocks.advanceOrder).toHaveBeenCalledWith({ orderId, to: "READY", actorUserId: staff.userId, orgId: staff.orgId });
  });
});

describe("completeDeliveryAction", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue({ ...staff, roles: ["RIDER"] });
    mocks.completeDelivery.mockReset().mockResolvedValue({ ok: true });
  });

  it("INVALID_INPUT before any permission check", async () => {
    const result = await completeDeliveryAction({ orderId: "not-a-uuid", cashCollected: true });
    expect(result).toEqual({ ok: false, code: "INVALID_INPUT", error: "That delivery could not be closed." });
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("closes with delivery.complete, scoped to the staff member's org", async () => {
    expect(await completeDeliveryAction({ orderId, cashCollected: true })).toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("delivery.complete");
    expect(mocks.completeDelivery).toHaveBeenCalledWith({ orderId, actorUserId: staff.userId, actorRoles: ["RIDER"], orgId: staff.orgId, cashCollected: true });
  });

  it.each(["ALREADY_CLOSED", "NOT_FOUND", "NOT_A_DELIVERY", "NOT_OUT_FOR_DELIVERY", "PAYMENT_REFUSED", "TRANSITION_REFUSED"] as const)(
    "passes the repository's %s code and message through",
    async (code) => {
      mocks.completeDelivery.mockResolvedValue({ ok: false, code, error: `message for ${code}` });
      expect(await completeDeliveryAction({ orderId, cashCollected: false })).toEqual({ ok: false, code, error: `message for ${code}` });
    },
  );

  it("SIGNED_OUT and NOT_PERMITTED resolve with codes", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new NotSignedIn());
    expect(await completeDeliveryAction({ orderId, cashCollected: false })).toMatchObject({ ok: false, code: "SIGNED_OUT" });
    mocks.requirePermission.mockRejectedValueOnce(new NotPermitted("delivery.complete"));
    expect(await completeDeliveryAction({ orderId, cashCollected: false })).toMatchObject({ ok: false, code: "NOT_PERMITTED" });
    expect(mocks.completeDelivery).not.toHaveBeenCalled();
  });

  it("an unexpected server exception resolves as SERVER_ERROR without leaking its message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.completeDelivery.mockRejectedValue(new Error('relation "orders" does not exist at 10.0.0.5'));
    const result = await completeDeliveryAction({ orderId, cashCollected: true });
    expect(result).toEqual({ ok: false, code: "SERVER_ERROR", error: "Something went wrong closing that delivery. Try again." });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

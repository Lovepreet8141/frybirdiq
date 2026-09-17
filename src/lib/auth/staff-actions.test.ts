import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  advanceOrder: vi.fn(),
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
  completeDelivery: vi.fn(),
  rejectOrder: vi.fn(),
}));
vi.mock("@/lib/repositories/payments", () => ({ recordCashPayment: vi.fn() }));

import { advanceOrderAction } from "./staff-actions";

const orderId = "7d9f2c1e-4b3a-4c5d-8e6f-1a2b3c4d5e6f";
const staff = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222", roles: ["CASHIER"] };

describe("advanceOrderAction", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue(staff);
    mocks.advanceOrder.mockReset().mockResolvedValue({ ok: true });
  });

  it("refuses REFUNDED without touching the order: only refundPayment may set it", async () => {
    const result = await advanceOrderAction({ orderId, to: "REFUNDED" });
    expect(result.ok).toBe(false);
    expect(result.error).toEqual(expect.any(String));
    expect(mocks.advanceOrder).not.toHaveBeenCalled();
  });

  it("refuses PAID without touching the order: only a recorded payment may set it", async () => {
    const result = await advanceOrderAction({ orderId, to: "PAID" });
    expect(result.ok).toBe(false);
    expect(mocks.advanceOrder).not.toHaveBeenCalled();
  });

  it("still moves a ticket forward with kitchen.update, scoped to the staff member's org", async () => {
    const result = await advanceOrderAction({ orderId, to: "READY" });
    expect(result).toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("kitchen.update");
    expect(mocks.advanceOrder).toHaveBeenCalledWith({ orderId, to: "READY", actorUserId: staff.userId, orgId: staff.orgId });
  });

  it("still requires orders.cancel to cancel", async () => {
    await advanceOrderAction({ orderId, to: "CANCELLED" });
    expect(mocks.requirePermission).toHaveBeenCalledWith("orders.cancel");
    expect(mocks.advanceOrder).toHaveBeenCalledOnce();
  });
});

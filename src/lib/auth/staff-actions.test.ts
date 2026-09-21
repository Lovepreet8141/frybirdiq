import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  advanceOrder: vi.fn(),
  readyGateRefusal: vi.fn(),
  completeDelivery: vi.fn(),
  assignRider: vi.fn(),
  failDelivery: vi.fn(),
  takeDelivery: vi.fn(),
  releaseDelivery: vi.fn(),
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
vi.mock("@/lib/repositories/kitchen-stations", () => ({ readyGateRefusal: mocks.readyGateRefusal }));
vi.mock("@/lib/repositories/payments", () => ({ recordCashPayment: vi.fn() }));
vi.mock("@/lib/repositories/rider-assignment", () => ({
  FAIL_REASON_MIN: 3,
  FAIL_REASON_MAX: 200,
  assignRider: mocks.assignRider,
  failDelivery: mocks.failDelivery,
  takeDelivery: mocks.takeDelivery,
  releaseDelivery: mocks.releaseDelivery,
}));

import { NotPermitted, NotSignedIn } from "@/lib/auth";
import { advanceOrderAction, assignRiderAction, completeDeliveryAction, failDeliveryAction, releaseDeliveryAction, takeDeliveryAction } from "./staff-actions";

const orderId = "7d9f2c1e-4b3a-4c5d-8e6f-1a2b3c4d5e6f";
const staff = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222", roles: ["CASHIER"] };

describe("advanceOrderAction", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue(staff);
    mocks.advanceOrder.mockReset().mockResolvedValue({ ok: true });
    mocks.readyGateRefusal.mockReset().mockResolvedValue(null);
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

  it("READY is refused with the station gate's reason, and nothing advances (ready-gate-enforce)", async () => {
    mocks.readyGateRefusal.mockResolvedValue("1 line is not done at the stations yet.");
    const result = await advanceOrderAction({ orderId, to: "READY" });
    expect(result).toEqual({ ok: false, error: "1 line is not done at the stations yet." });
    expect(mocks.readyGateRefusal).toHaveBeenCalledWith(staff.orgId, orderId);
    expect(mocks.advanceOrder).not.toHaveBeenCalled();
  });

  it("other moves never consult the station gate", async () => {
    await advanceOrderAction({ orderId, to: "PREPARING" });
    expect(mocks.readyGateRefusal).not.toHaveBeenCalled();
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

describe("assignRiderAction", () => {
  const riderUserId = "33333333-3333-4333-8333-333333333333";
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue({ ...staff, roles: ["MANAGER"] });
    mocks.assignRider.mockReset().mockResolvedValue({ ok: true, changed: true });
  });

  it("checks delivery.assign, then assigns within the staff member's own org; the client sends no org", async () => {
    expect(await assignRiderAction({ orderId, riderUserId })).toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("delivery.assign");
    expect(mocks.assignRider).toHaveBeenCalledWith({ orgId: staff.orgId, orderId, riderUserId, actorUserId: staff.userId });
  });

  it("refuses bad input before any permission check or database call", async () => {
    expect(await assignRiderAction({ orderId: "nope", riderUserId })).toMatchObject({ ok: false });
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.assignRider).not.toHaveBeenCalled();
  });

  it("without the permission nothing is assigned", async () => {
    mocks.requirePermission.mockRejectedValue(new NotPermitted("delivery.assign" as never));
    expect(await assignRiderAction({ orderId, riderUserId })).toMatchObject({ ok: false });
    expect(mocks.assignRider).not.toHaveBeenCalled();
  });
});

describe("failDeliveryAction", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue({ ...staff, roles: ["RIDER"] });
    mocks.failDelivery.mockReset().mockResolvedValue({ ok: true });
  });

  it("checks delivery.complete and hands the actor's roles to the repository, which limits a rider to their own delivery", async () => {
    expect(await failDeliveryAction({ orderId, reason: "Customer not answering" })).toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("delivery.complete");
    expect(mocks.failDelivery).toHaveBeenCalledWith({ orgId: staff.orgId, orderId, actorUserId: staff.userId, actorRoles: ["RIDER"], reason: "Customer not answering" });
  });

  it("a blank or missing reason never reaches the repository", async () => {
    expect(await failDeliveryAction({ orderId, reason: "  " })).toMatchObject({ ok: false });
    expect(mocks.failDelivery).not.toHaveBeenCalled();
  });
});

describe("takeDeliveryAction", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue({ ...staff, roles: ["RIDER"] });
    mocks.takeDelivery.mockReset().mockResolvedValue({ ok: true, changed: true });
  });

  it("checks delivery.take and takes it for the signed-in rider in their own org: the client sends only the order", async () => {
    expect(await takeDeliveryAction({ orderId, riderUserId: "someone-else", orgId: "another-org" })).toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("delivery.take");
    expect(mocks.takeDelivery).toHaveBeenCalledWith({ orgId: staff.orgId, orderId, riderUserId: staff.userId });
  });

  it("refuses bad input before any permission check or database call", async () => {
    expect(await takeDeliveryAction({ orderId: "nope" })).toMatchObject({ ok: false });
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.takeDelivery).not.toHaveBeenCalled();
  });

  it("tells the rider plainly when someone else got there first", async () => {
    mocks.takeDelivery.mockResolvedValue({ ok: false, code: "ALREADY_TAKEN", error: "Someone else has just taken that delivery." });
    expect(await takeDeliveryAction({ orderId })).toEqual({ ok: false, error: "Someone else has just taken that delivery." });
  });
});

describe("releaseDeliveryAction", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset().mockResolvedValue({ ...staff, roles: ["RIDER"] });
    mocks.releaseDelivery.mockReset().mockResolvedValue({ ok: true });
  });

  it("checks delivery.take and releases for the signed-in rider in their own org: the client sends only the order", async () => {
    expect(await releaseDeliveryAction({ orderId, riderUserId: "someone-else", orgId: "another-org" })).toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("delivery.take");
    expect(mocks.releaseDelivery).toHaveBeenCalledWith({ orgId: staff.orgId, orderId, riderUserId: staff.userId });
  });

  it("refuses bad input before any permission check or database call, and shows the refusal when it is not theirs", async () => {
    expect(await releaseDeliveryAction({ orderId: "nope" })).toMatchObject({ ok: false });
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    mocks.releaseDelivery.mockResolvedValue({ ok: false, code: "NOT_YOUR_DELIVERY", error: "That delivery is not yours." });
    expect(await releaseDeliveryAction({ orderId })).toEqual({ ok: false, error: "That delivery is not yours." });
  });
});

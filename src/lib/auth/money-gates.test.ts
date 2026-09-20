/**
 * The money actions refuse every role that lacks their permission — at
 * runtime, not just in the source (pay-ready). permission-gates.test.ts pins
 * which permission each action names; this proves the refusal happens before
 * anything that moves money or an order.
 *
 * For each action: every real role WITHOUT the permission is refused and the
 * repository is never called; a role WITH it reaches the repository with the
 * same input — so a refusal here can only be the gate, never bad input.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Permission, ROLES, type Role, can } from "@/domain/permissions";

let roles: readonly Role[] = [];

vi.mock("@/lib/auth", async () => {
  const { can: allowed } = await import("@/domain/permissions");
  class NotSignedIn extends Error {}
  class NotPermitted extends Error {}
  const staff = () => ({ userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", roles });
  return {
    NotSignedIn,
    NotPermitted,
    getStaff: async () => staff(),
    requireStaff: async () => staff(),
    staffCan: async (permission: Permission) => allowed(roles, permission),
    requirePermission: async (permission: Permission) => {
      if (!allowed(roles, permission)) throw new NotPermitted(permission);
      return staff();
    },
  };
});

const repo = {
  recordCashPayment: vi.fn(async () => ({ ok: true, paymentId: "p", replayed: false })),
  refundPayment: vi.fn(async () => ({ ok: true, refundId: "r", orderId: "o" })),
  isOrderPaid: vi.fn(async () => true),
  advanceOrder: vi.fn(async () => ({ ok: true })),
  acceptOrder: vi.fn(async () => ({ ok: true })),
  rejectOrder: vi.fn(async () => ({ ok: true })),
  completeDelivery: vi.fn(async () => ({ ok: true })),
  placeCounterOrder: vi.fn(async () => ({ ok: true, orderId: "o", orderNumber: "1", total: 100n, replayed: false })),
};

vi.mock("@/lib/repositories/payments", () => ({
  recordCashPayment: (...a: unknown[]) => repo.recordCashPayment(...(a as [])),
  refundPayment: (...a: unknown[]) => repo.refundPayment(...(a as [])),
  isOrderPaid: (...a: unknown[]) => repo.isOrderPaid(...(a as [])),
}));
vi.mock("@/lib/repositories/orders", () => ({
  advanceOrder: (...a: unknown[]) => repo.advanceOrder(...(a as [])),
  acceptOrder: (...a: unknown[]) => repo.acceptOrder(...(a as [])),
  rejectOrder: (...a: unknown[]) => repo.rejectOrder(...(a as [])),
  completeDelivery: (...a: unknown[]) => repo.completeDelivery(...(a as [])),
  placeCounterOrder: (...a: unknown[]) => repo.placeCounterOrder(...(a as [])),
}));
vi.mock("@/lib/repositories/customers", () => ({ findCustomerByPhone: vi.fn(async () => null) }));
vi.mock("@/lib/repositories/loyalty", () => ({ getPointsBalance: vi.fn(async () => 0), getStampAccountState: vi.fn(async () => null) }));
vi.mock("@/lib/loyalty/config", () => ({ getLoyaltyConfig: vi.fn(async () => null), getStampConfig: vi.fn(async () => null) }));
vi.mock("@/lib/loyalty", () => ({ isLoyaltyEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/repositories/menu", () => ({ getMenu: vi.fn(async () => []) }));
vi.mock("@/lib/repositories/receipt", () => ({ receiptDataForOrder: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

const staffActions = await import("./staff-actions");
const { refundPaymentAction } = await import("@/lib/finance/actions");
const { placeCounterOrderAction } = await import("@/lib/pos/actions");

const ORDER = "4b3a2c1d-0e0f-4a1b-8c2d-3e4f5a6b7c8d";
const KEY = "0f0e0d0c-0b0a-4090-8070-605040302010";

type Case = { action: string; permission: Permission; call: () => Promise<{ ok: boolean }>; reaches: keyof typeof repo };
const CASES: readonly Case[] = [
  { action: "markPaidAction", permission: "orders.update", call: () => staffActions.markPaidAction({ orderId: ORDER }), reaches: "recordCashPayment" },
  { action: "advanceOrderAction", permission: "kitchen.update", call: () => staffActions.advanceOrderAction({ orderId: ORDER, to: "PREPARING" }), reaches: "advanceOrder" },
  { action: "acceptOrderAction", permission: "kitchen.update", call: () => staffActions.acceptOrderAction({ orderId: ORDER, prepMinutes: 15 }), reaches: "acceptOrder" },
  { action: "rejectOrderAction", permission: "orders.cancel", call: () => staffActions.rejectOrderAction({ orderId: ORDER, reason: "SOLD_OUT" }), reaches: "rejectOrder" },
  { action: "completeDeliveryAction", permission: "delivery.complete", call: () => staffActions.completeDeliveryAction({ orderId: ORDER, cashCollected: true }), reaches: "completeDelivery" },
  { action: "refundPaymentAction", permission: "orders.refund", call: () => refundPaymentAction({ paymentId: ORDER, amount: "150", reason: "Cold food", idempotencyKey: KEY }), reaches: "refundPayment" },
  {
    action: "placeCounterOrderAction",
    permission: "orders.create",
    call: () => placeCounterOrderAction({ lines: [{ slug: "zinger-burger", quantity: 1 }], channel: "TAKEAWAY", idempotencyKey: KEY, cashReceived: "500" }),
    reaches: "placeCounterOrder",
  },
];

describe("money actions refuse an unpermitted role before touching anything", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(CASES)("$action ($permission)", ({ permission, call, reaches }) => {
    const refused = ROLES.filter((role) => !can([role], permission));
    const permitted = ROLES.find((role) => can([role], permission));

    it("has at least one role that may not do it", () => {
      expect(refused.length).toBeGreaterThan(0);
    });

    it.each(refused)("refuses %s, and nothing is called", async (role) => {
      roles = [role];
      const result = await call();
      expect(result.ok).toBe(false);
      for (const spy of Object.values(repo)) expect(spy).not.toHaveBeenCalled();
    });

    it("lets a permitted role through to the repository with the same input (so the refusal above is the gate, not the input)", async () => {
      roles = [permitted!];
      await call();
      expect(repo[reaches]).toHaveBeenCalled();
    });
  });
});

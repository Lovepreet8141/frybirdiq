import { describe, expect, it } from "vitest";

import { defineCatalogEntry } from "./catalog";
import {
  MONEY_DOMAINS,
  OPERATIONAL_DOMAINS,
  isExecutableTier,
  isMoneyDomain,
  requiresApprovalByDefault,
  type TierFor,
} from "./tiers";

describe("money domains (DESIGN-v2-DELTA §4)", () => {
  it("lists every domain the design names", () => {
    expect([...MONEY_DOMAINS].sort()).toEqual(
      [
        "payments",
        "refunds",
        "settlements",
        "invoices",
        "order_money",
        "prices",
        "tax",
        "expenses",
        "loyalty_balances",
        "customer_bulk_messaging",
        "data_deletion",
        "invoice_numbering",
        "loyalty_issue_expiry",
        "delivery_fees_zones",
        "cash_float",
        "discounts_cancellations",
        "cod_payment_toggles",
        "supplier_payments",
        "payroll",
      ].sort(),
    );
  });

  it("never overlaps the operational domains", () => {
    for (const domain of OPERATIONAL_DOMAINS) expect(isMoneyDomain(domain)).toBe(false);
    for (const domain of MONEY_DOMAINS) expect(isMoneyDomain(domain)).toBe(true);
    expect(isMoneyDomain("somewhere_else")).toBe(false);
  });

  it("forces A3 at the type level", () => {
    const refund: TierFor<"refunds"> = "A3";
    // @ts-expect-error — a refund cannot be A2
    const refundA2: TierFor<"refunds"> = "A2";
    // @ts-expect-error — a price change cannot be A1
    defineCatalogEntry({ domain: "prices", tier: "A1", undo: { kind: "NONE" }, blockedBy: null, summary: "x" });
    // @ts-expect-error — sending a purchase order commits supplier spend
    defineCatalogEntry({ domain: "supplier_payments", tier: "A2", undo: { kind: "NONE" }, blockedBy: null, summary: "x" });
    const inventoryA1: TierFor<"inventory"> = "A1";
    expect([refund, refundA2, inventoryA1]).toEqual(["A3", "A2", "A1"]);
  });
});

describe("tier rules (INTELLIGENCE-ENGINE §4)", () => {
  it("never executes A3", () => {
    expect(isExecutableTier("A0")).toBe(true);
    expect(isExecutableTier("A1")).toBe(true);
    expect(isExecutableTier("A2")).toBe(true);
    expect(isExecutableTier("A3")).toBe(false);
  });

  it("needs approval for A1 and A2 unless a policy says otherwise", () => {
    expect(requiresApprovalByDefault("A0")).toBe(false);
    expect(requiresApprovalByDefault("A1")).toBe(true);
    expect(requiresApprovalByDefault("A2")).toBe(true);
    expect(requiresApprovalByDefault("A3")).toBe(false);
  });
});

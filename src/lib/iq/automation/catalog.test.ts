import { describe, expect, it } from "vitest";

import { IdentifierSchema } from "../engine";
import {
  ACTION_CATALOG,
  ACTION_KINDS,
  isActionKind,
  isExecutableKind,
  tierIsPermitted,
  type A1ActionKind,
  type ExecutableActionKind,
} from "./catalog";
import { MONEY_DOMAINS, OPERATIONAL_DOMAINS, isMoneyDomain } from "./tiers";

const tierOf = (kind: string) => ACTION_CATALOG[kind as keyof typeof ACTION_CATALOG].tier;

describe("the action catalog (DESIGN §4, DESIGN-v2-DELTA §4)", () => {
  it("places every designed kind at its tier", () => {
    const byTier = (tier: string) => ACTION_KINDS.filter((k) => tierOf(k) === tier).sort();
    expect(byTier("A0")).toEqual(["brief.publish", "detection.publish", "forecast.publish", "reconciliation.report"]);
    expect(byTier("A1")).toEqual([
      "inventory.flag_recount",
      "prep_list.prefill",
      "purchase_order.create_draft",
      "task.open_internal",
    ]);
    expect(byTier("A2")).toEqual(["customer.winback_message", "menu.mark_86"]);
    expect(byTier("A3")).toEqual([
      "data.delete",
      "price.change",
      "promotion.change_discount",
      "promotion.extend",
      "promotion.stop",
      "purchase_order.send",
      "refund.create",
      "tax.change",
    ]);
  });

  it("settles Q-AA-1: sending a purchase order and extending or stopping a promotion are A3", () => {
    expect(tierOf("purchase_order.send")).toBe("A3");
    expect(tierOf("promotion.extend")).toBe("A3");
    expect(tierOf("promotion.stop")).toBe("A3");
  });

  it.each(ACTION_KINDS)("%s: a money domain means A3", (kind) => {
    const entry = ACTION_CATALOG[kind];
    if (isMoneyDomain(entry.domain)) expect(entry.tier).toBe("A3");
    expect(tierIsPermitted(entry.domain, entry.tier)).toBe(true);
  });

  it.each(ACTION_KINDS)("%s: kind is a valid identifier and its domain is known", (kind) => {
    expect(IdentifierSchema.safeParse(kind).success).toBe(true);
    expect([...MONEY_DOMAINS, ...OPERATIONAL_DOMAINS]).toContain(ACTION_CATALOG[kind].domain);
  });

  it.each(ACTION_KINDS)("%s: undo is coherent with the tier", (kind) => {
    const { tier, undo } = ACTION_CATALOG[kind];
    if (tier === "A0" || tier === "A3") expect(undo.kind).toBe("NONE");
    if (tier === "A1") expect(undo.kind).toBe("REVERT");
    if (undo.kind !== "NONE") expect(undo.windowSeconds).toBeGreaterThan(0);
  });

  it("blocks the win-back message on owner decision dec-5", () => {
    expect(ACTION_CATALOG["customer.winback_message"].blockedBy).toBe("dec-5");
    expect(ACTION_KINDS.filter((k) => ACTION_CATALOG[k].blockedBy !== null)).toEqual(["customer.winback_message"]);
  });

  it("refuses a money domain below A3 at runtime", () => {
    for (const domain of MONEY_DOMAINS) {
      expect(tierIsPermitted(domain, "A0")).toBe(false);
      expect(tierIsPermitted(domain, "A1")).toBe(false);
      expect(tierIsPermitted(domain, "A2")).toBe(false);
      expect(tierIsPermitted(domain, "A3")).toBe(true);
    }
  });

  it("knows its own kinds and nothing else", () => {
    expect(isActionKind("menu.mark_86")).toBe(true);
    expect(isActionKind("refund.execute")).toBe(false);
    expect(isActionKind("toString")).toBe(false);
  });

  it("has no executable A3 kind, by type and at runtime", () => {
    expect(ACTION_KINDS.filter((k) => isExecutableKind(k) && tierOf(k) === "A3")).toEqual([]);
    const draft: ExecutableActionKind = "purchase_order.create_draft";
    // @ts-expect-error — a refund has no executor
    const refund: ExecutableActionKind = "refund.create";
    // @ts-expect-error — a price change has no executor
    const price: ExecutableActionKind = "price.change";
    // @ts-expect-error — an A2 kind is not an A1 kind
    const eightySix: A1ActionKind = "menu.mark_86";
    expect([draft, refund, price, eightySix]).toHaveLength(4);
  });
});

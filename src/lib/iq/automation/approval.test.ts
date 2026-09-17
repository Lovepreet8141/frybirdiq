import { describe, expect, it } from "vitest";

import { classifyDecisionMiss, isPersonDecided, type DecisionRowView } from "./approval";

const now = new Date("2026-09-17T10:00:00+05:30");
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const ME = "11111111-1111-4111-8111-111111111111";
const YOU = "22222222-2222-4222-8222-222222222222";

const row = (overrides: Partial<DecisionRowView> = {}): DecisionRowView => ({
  tier: "A2",
  autoPolicyId: null,
  status: "PENDING_APPROVAL",
  paramsHash: HASH,
  approvalExpiresAt: new Date(now.getTime() + 60_000),
  approvedBy: null,
  decidedBy: null,
  ...overrides,
});

const approve = { decision: "APPROVE" as const, userId: ME, paramsHash: HASH };
const reject = { decision: "REJECT" as const, userId: ME, paramsHash: HASH };

describe("classifyDecisionMiss (DESIGN-v2-DELTA §4)", () => {
  it("does not reveal rows a person does not decide", () => {
    expect(classifyDecisionMiss(null, approve, now)).toEqual({ ok: false, reason: "NOT_FOUND" });
    for (const r of [row({ tier: "A0" }), row({ tier: "A3", status: "HANDOFF" }), row({ tier: "A1", autoPolicyId: "p" })]) {
      expect(classifyDecisionMiss(r, approve, now)).toEqual({ ok: false, reason: "NOT_FOUND" });
    }
    expect(isPersonDecided(row({ tier: "A1" }))).toBe(true);
  });

  it("treats the same person repeating the same decision as success", () => {
    for (const status of ["APPROVED", "EXECUTING", "SUCCEEDED", "FAILED", "UNDONE"] as const) {
      expect(classifyDecisionMiss(row({ status, approvedBy: ME }), approve, now)).toEqual({ ok: true, repeated: true });
    }
    expect(classifyDecisionMiss(row({ status: "REJECTED", decidedBy: ME }), reject, now)).toEqual({ ok: true, repeated: true });
  });

  it("is ALREADY_DECIDED for someone else's decision, the opposite decision, or changed params", () => {
    expect(classifyDecisionMiss(row({ status: "APPROVED", approvedBy: YOU }), approve, now)).toEqual({
      ok: false,
      reason: "ALREADY_DECIDED",
    });
    expect(classifyDecisionMiss(row({ status: "REJECTED", decidedBy: ME }), approve, now)).toEqual({
      ok: false,
      reason: "ALREADY_DECIDED",
    });
    expect(classifyDecisionMiss(row({ status: "APPROVED", approvedBy: ME }), reject, now)).toEqual({
      ok: false,
      reason: "ALREADY_DECIDED",
    });
    expect(classifyDecisionMiss(row({ status: "APPROVED", approvedBy: ME, paramsHash: OTHER_HASH }), approve, now)).toEqual({
      ok: false,
      reason: "ALREADY_DECIDED",
    });
    for (const status of ["EXPIRED", "SUPERSEDED", "CANCELLED"] as const) {
      expect(classifyDecisionMiss(row({ status }), approve, now)).toEqual({ ok: false, reason: "ALREADY_DECIDED" });
    }
  });

  it("names stale params before expiry, and expiry by database time", () => {
    expect(classifyDecisionMiss(row({ paramsHash: OTHER_HASH, approvalExpiresAt: now }), approve, now)).toEqual({
      ok: false,
      reason: "STALE_PARAMS",
    });
    for (const approvalExpiresAt of [now, new Date(now.getTime() - 1), null]) {
      expect(classifyDecisionMiss(row({ approvalExpiresAt }), reject, now)).toEqual({ ok: false, reason: "EXPIRED" });
    }
  });

  it("falls back to ALREADY_DECIDED when the row reads as still decidable", () => {
    expect(classifyDecisionMiss(row(), approve, now)).toEqual({ ok: false, reason: "ALREADY_DECIDED" });
  });
});

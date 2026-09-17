import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { allReadings, reading } from "./__test-support__/readings";
import { CLAIM_STUCK_OPERATIONS, PRE_REFUND_SIGNATURES, evaluateSignatures, severityOf, signatureDedupeKey } from "./pre-refund";

describe("pre-refund money signatures (IQ-2 §1b, R2.7)", () => {
  it("lists exactly the seven pre-release rules with their severities", () => {
    expect(PRE_REFUND_SIGNATURES.map((r) => [r.ruleId, r.severity])).toEqual([
      ["sig.double_capture", 3],
      ["sig.refund_unrecorded", 3],
      ["sig.refund_followup_lost", 2],
      ["sig.half_order", 2],
      ["sig.capture_on_terminal", 3],
      ["sig.claim_stuck", 2],
      ["sig.webhook_failed", 2],
    ]);
    expect(PRE_REFUND_SIGNATURES.every((r) => r.ruleId.startsWith("sig."))).toBe(true);
    expect(PRE_REFUND_SIGNATURES.every((r) => r.minAgeMinutes >= 5)).toBe(true);
  });

  it("claim_stuck watches exactly the four money operations (R2.7 P2)", () => {
    expect([...CLAIM_STUCK_OPERATIONS]).toEqual(["placeOrder", "placeCounterOrder", "recordPayment", "refund_payment"]);
  });

  it("uses one stable dedupe key per rule", () => {
    expect(signatureDedupeKey("sig.double_capture")).toBe("sig:sig.double_capture");
  });

  it("fires on a count above zero, clears on zero", () => {
    const { outcomes, summary } = evaluateSignatures(allReadings({ "sig.half_order": 2 }));
    const half = outcomes.find((o) => o.ruleId === "sig.half_order");
    expect(half).toMatchObject({ status: "FIRED", severity: 2, dedupeKey: "sig:sig.half_order" });
    expect(outcomes.filter((o) => o.status === "CLEAR")).toHaveLength(6);
    expect(summary).toEqual({ rules_fired: 1, rules_clear: 6, rule_timeout: 0 });
    expect(severityOf("sig.double_capture")).toBe(3);
  });

  it("never clears a rule that timed out or was not read", () => {
    const readings = allReadings().filter((r) => r.ruleId !== "sig.webhook_failed");
    readings[0] = { ruleId: "sig.double_capture", status: "RULE_TIMEOUT" };
    const { outcomes, summary } = evaluateSignatures(readings);
    expect(outcomes.find((o) => o.ruleId === "sig.double_capture")?.status).toBe("NOT_EVALUATED");
    expect(outcomes.find((o) => o.ruleId === "sig.webhook_failed")?.status).toBe("NOT_EVALUATED");
    expect(summary.rule_timeout).toBe(2);
    expect(reading("sig.claim_stuck", 0).status).toBe("EVALUATED");
  });

  it("R2.5 lint-level: nothing under src/lib/iq/signatures formats money or imports the money module", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/@\/lib\/money|formatINR|formatAmount|Number\(\s*paise/);
    }
  });
});

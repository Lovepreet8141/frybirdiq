import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { rawFact } from "./__test-support__/insights";
import { canonicalJson, computeContentHash, contentHashInput, hasValidContentHash, sha256Hex } from "./content-hash";
import type { Evidence } from "./evidence";

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined fields", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: true, y: null }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":null,"z":true}]},"b":1}',
    );
  });

  it("refuses what JSON cannot state exactly", () => {
    expect(() => canonicalJson(1n)).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(new Date(0))).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
  });
});

describe("content hash", () => {
  const evidence: Evidence[] = [
    { kind: "insight", insightId: "11111111-1111-4111-8111-111111111111" },
    { kind: "action", actionId: "22222222-2222-4222-8222-222222222222" },
  ];
  const payload = rawFact().payload;

  it("is sha256 hex, matching node's implementation", async () => {
    expect(await sha256Hex("frybird")).toBe(createHash("sha256").update("frybird").digest("hex"));
  });

  it("ignores key order and evidence order", async () => {
    const reordered = { sourceQueryId: payload.sourceQueryId, value: payload.value, metricId: payload.metricId };
    const a = await computeContentHash({ payload, evidence });
    const b = await computeContentHash({ payload: reordered, evidence: [...evidence].reverse() });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a figure changes", async () => {
    const a = await computeContentHash({ payload, evidence });
    const b = await computeContentHash({ payload: { ...payload, value: { unit: "paise", value: "4250001" } }, evidence });
    expect(a).not.toBe(b);
  });

  it("hashes a fixed, documented input", () => {
    expect(contentHashInput({ payload: { b: 1, a: 2 }, evidence: [evidence[1]!, evidence[0]!] })).toBe(
      '{"evidence":[{"actionId":"22222222-2222-4222-8222-222222222222","kind":"action"},{"insightId":"11111111-1111-4111-8111-111111111111","kind":"insight"}],"payload":{"a":2,"b":1}}',
    );
  });

  it("verifies a stored hash", async () => {
    const contentHash = await computeContentHash({ payload, evidence });
    expect(await hasValidContentHash({ payload, evidence, contentHash })).toBe(true);
    expect(await hasValidContentHash({ payload, evidence, contentHash: "0".repeat(64) })).toBe(false);
  });
});

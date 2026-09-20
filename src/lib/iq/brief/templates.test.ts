import { describe, expect, it } from "vitest";

import { BASELINE_RULES } from "@/lib/iq/detect/rules";

import * as T from "./templates";

function strings(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  return [];
}

const KNOWN_SLOTS = new Set(["value", "current", "currentFrom", "currentTo", "previous", "previousFrom", "previousTo", "reason", "observed", "baseline", "deviation", "weekday", "direction", "start", "end", "metric", "card", "check", "date", "metrics", "time", "count"]);

describe("brief templates", () => {
  const all = Object.entries(T)
    .filter(([, v]) => typeof v !== "function")
    .flatMap(([name, v]) => strings(v, name));

  it("carry no number of their own", () => {
    expect(all.length).toBeGreaterThan(50);
    for (const { path, text } of all) expect(text, path).not.toMatch(/\d/);
  });

  it("name no rule id, signal code or grade in words the owner reads", () => {
    const sentences = all.filter(({ path }) => !/^(RULE_GROUPS|BRIEF_DAY_METRICS)/.test(path));
    for (const { path, text } of sentences) {
      expect(text, path).not.toMatch(/\b(GRADE_|recon\.|sig\.|detect\.|T\d|t\d_)|\b(HIGH|MEDIUM|LOW|UNKNOWN)\b/);
    }
  });

  it("use only slots compose.ts fills", () => {
    for (const { path, text } of all) {
      for (const piece of T.parseTemplate(text)) if (piece.kind === "slot") expect(KNOWN_SLOTS.has(piece.name), `${path}: {${piece.name}}`).toBe(true);
    }
  });

  it("parse text and slots in order", () => {
    expect(T.parseTemplate("Orders: {value} today")).toEqual([
      { kind: "text", text: "Orders: " },
      { kind: "slot", name: "value" },
      { kind: "text", text: " today" },
    ]);
    expect(T.parseTemplate("{a}{b}")).toEqual([{ kind: "slot", name: "a" }, { kind: "slot", name: "b" }]);
  });

  it("cover every baseline detector rule, and explain every skipped-comparison rule in words", () => {
    for (const rule of BASELINE_RULES) {
      expect(T.DETECTION_TEMPLATES[`detect.${rule.ruleId}`], rule.ruleId).toBeDefined();
      expect(T.RULE_WORDS[rule.ruleId], rule.ruleId).toBeDefined();
    }
    expect(T.DETECTION_TEMPLATES["detect.refunds.spike"]).toBeDefined();
    expect(T.DETECTION_TEMPLATES["detect.food_cost.above_target"]).toBeDefined();
  });

  it("put Collected on the GST-inclusive, after-refunds basis (C3)", () => {
    expect(T.FACT_TEMPLATES.net_collected).toBe("Collected after refunds (incl. GST): {value}");
    expect(T.FACT_TEMPLATES.revenue_net).toContain("excl. GST");
  });
});

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * R2.5: money stays bigint end to end in the reconciliation rules — no
 * formatting (that happens at render), no floats, no Number() on amounts.
 */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const BANNED: readonly [RegExp, string][] = [
  [/\bformat(INR|Amount|Bps)\b/, "formats money"],
  [/\btoPlainDecimal\b/, "formats money"],
  [/\bparseFloat\b|\bparseInt\b/, "parses a number as a float or int"],
  [/\bNumber\(/, "converts to a JS number"],
  [/\bMath\.(round|floor|ceil)\b/, "rounds with floating point"],
  [/\btoFixed\(/, "rounds with floating point"],
];

describe("iq/reconcile money hygiene", () => {
  it("covers the rule, explanation and job modules", () => {
    expect(SOURCES.sort()).toEqual(["explanations.ts", "reconcile-job.ts", "rules.ts"]);
  });

  it.each(SOURCES)("%s neither formats money nor leaves bigint", (file) => {
    const source = readFileSync(path.join(DIR, file), "utf8");
    for (const [pattern, why] of BANNED) expect(pattern.test(source), `${file} ${why}`).toBe(false);
  });
});

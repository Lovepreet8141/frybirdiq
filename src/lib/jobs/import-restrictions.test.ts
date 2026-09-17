import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Static, ESLint-independent guard for the three `no-restricted-imports`
 * rules in eslint.config.mjs (IQ-0 S9). ESLint enforces these at lint time;
 * this test re-derives the same violations directly from source text so a
 * future edit to eslint.config.mjs that quietly narrows or drops a rule
 * still fails CI here. See hive/reviews/iq-0/DESIGN.md §3 and the ARCHITECT
 * review of accdd93 (P2 #1, iq0-s1r).
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const IMPORT_FROM = /from\s+["']([^"']+)["']/g;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listSourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function importSpecifiers(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(IMPORT_FROM)]
    .map((m) => m[1])
    .filter((spec): spec is string => spec !== undefined);
}

function rel(path: string): string {
  return relative(SRC, path);
}

describe("IQ-0 S9: restricted imports (mirrors eslint.config.mjs no-restricted-imports)", () => {
  it("src/lib/iq/engine stays pure: no DB, Next.js, or React import", () => {
    const banned = /^(next(\/.*)?|react|react-dom|drizzle-orm|postgres|@\/db(\/.*)?|@\/lib\/repositories\/.*|@\/lib\/supabase\/.*)$/;
    const offenders: string[] = [];
    for (const file of listSourceFiles(join(SRC, "lib/iq/engine"))) {
      for (const spec of importSpecifiers(file)) {
        if (banned.test(spec)) offenders.push(`${rel(file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("src/lib/jobs and src/app/api/jobs do not import payments/orders/finance writers", () => {
    const banned = /^@\/lib\/repositories\/(payments|orders|finance)$/;
    const dirs = [join(SRC, "lib/jobs"), join(SRC, "app/api/jobs")].filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of listSourceFiles(dir)) {
        for (const spec of importSpecifiers(file)) {
          if (banned.test(spec)) offenders.push(`${rel(file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only src/lib/repositories/iq-*.ts and the engine itself mint an Observed quantity", () => {
    const mintingNames = [
      "ObservedSchema",
      "InsightSchema",
      "FactPayloadSchema",
      "DetectionPayloadSchema",
      "ForecastPayloadSchema",
      "ExplanationPayloadSchema",
      "RecommendationPayloadSchema",
      "AutomationPayloadSchema",
    ];
    const bannedModule = /^@\/lib\/iq\/engine(\/(observed-factory|insight|claims))?$/;
    const allowed = (file: string) => rel(file).startsWith(join("lib", "iq", "engine")) || /^lib\/repositories\/iq-[^/]+\.ts$/.test(rel(file));
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC)) {
      if (allowed(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(file)) {
        if (!bannedModule.test(spec)) continue;
        if (spec !== "@/lib/iq/engine") {
          offenders.push(`${rel(file)} -> ${spec}`);
          continue;
        }
        const named = mintingNames.filter((n) => new RegExp(`[{,]\\s*${n}\\s*[,}]`).test(text));
        if (named.length > 0) offenders.push(`${rel(file)} -> @/lib/iq/engine (${named.join(", ")})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

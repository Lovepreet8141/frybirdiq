import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|sql)$/;

describe("source hygiene (SECURITY-TENANCY review of ff7b92b)", () => {
  it("has no NUL byte in any text source under src/, so git never treats one as binary", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (TEXT.test(name) && readFileSync(path).includes(0)) offenders.push(path.slice(SRC.length));
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

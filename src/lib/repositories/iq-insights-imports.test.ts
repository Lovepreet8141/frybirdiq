import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it, vi } from "vitest";

// ESLint's Node API cold-starts typescript-eslint; the first lint can outrun 5s.
vi.setConfig({ testTimeout: 20_000 });

/**
 * ARCHITECT iq2-s2-arch P2: the ungated insight readers and writers must not
 * be reachable from code that renders for a person. Page, component and
 * other non-repository code gets insights only through `loadInsightsFor`,
 * which applies the finance.view gate. Checked through the real
 * eslint.config.mjs, with virtual fixture paths under `__fixtures__`.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: path.dirname(SRC) });

async function ruleIdsFor(relativeFilePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(SRC, relativeFilePath) });
  return (result?.messages ?? []).map((m) => m.ruleId).filter((id): id is string => id !== null);
}

describe("ungated insight readers are banned outside repositories and jobs", () => {
  it.each(["listInsights", "getInsight", "writeInsight", "expireInsights", "readFactFigures"])("a page may not import %s", async (name) => {
    const ids = await ruleIdsFor(`app/(app)/app/iq/__fixtures__/${name}-page.tsx`, `import { ${name} } from "@/lib/repositories/iq-insights";\nexport const x = ${name};\n`);
    expect(ids).toContain("no-restricted-imports");
  });

  it("a component may not reach them through a relative path either", async () => {
    const ids = await ruleIdsFor(
      "components/iq/__fixtures__/relative.tsx",
      'import { getInsight } from "../../../lib/repositories/iq-insights";\nexport const x = getInsight;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("the gated loader stays allowed for pages", async () => {
    const ids = await ruleIdsFor(
      "app/(app)/app/iq/__fixtures__/loader-page.tsx",
      'import { loadInsightsFor } from "@/lib/repositories/iq-insights";\nexport const x = loadInsightsFor;\n',
    );
    expect(ids).not.toContain("no-restricted-imports");
  });

  it("the minting ban still applies in the same files (no flat-config override)", async () => {
    const ids = await ruleIdsFor("app/(app)/app/iq/__fixtures__/minting.tsx", 'import { InsightSchema } from "@/lib/iq/engine";\nexport const x = InsightSchema;\n');
    expect(ids).toContain("no-restricted-imports");
  });
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Runs the real eslint.config.mjs against one small violating fixture per
 * IQ-0 S9 rule, via ESLint's Node API — not a hand-rolled regex re-scan of
 * source text. A regex re-scan cannot see through an aliased import
 * (`Name as X`), a namespace import (`import * as ns`), or a relative
 * import resolved against its own directory, and ARCHITECT's review of
 * 90b5d78 (iq0-s9r) refused exactly that gap. This test instead asks ESLint
 * itself whether each fixture is an error, so it fails the moment a rule in
 * eslint.config.mjs is weakened or removed — that file is the one and only
 * source of truth (do not duplicate it here, or in a separate scan; see
 * AUTOMATION-ARCHITECT's own scan in src/lib/jobs/registry.test.ts on
 * agent/automation-architect-mu4xnv9l — this file does not repeat that one
 * either). See hive/reviews/iq-0/DESIGN.md §3, and the ARCHITECT reviews of
 * accdd93 (P2 #1, iq0-s1r) and daa167f (iq0-s9r, iq0-s8r-arch item 2a).
 *
 * Fixtures use a virtual filePath under `${SRC}/**\/__fixtures__/` that is
 * never written to disk — ESLint's Node API only needs the path string to
 * pick the right config block and to resolve relative/aliased specifiers
 * against; the source text is passed straight to lintText. `__fixtures__`
 * is excluded from every restriction under test (eslint.config.mjs and this
 * file agree on that directory name), so a real `pnpm lint` run never
 * trips over these deliberately-broken snippets.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: path.dirname(SRC) });

async function ruleIdsFor(relativeFilePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(SRC, relativeFilePath) });
  return (result?.messages ?? []).map((m) => m.ruleId).filter((id): id is string => id !== null);
}

describe("IQ-0 S9: eslint.config.mjs restricted imports (fixture per rule, run through real ESLint)", () => {
  it("src/lib/iq/engine stays pure: no DB import", async () => {
    const ids = await ruleIdsFor(
      "lib/iq/engine/__fixtures__/db-import.ts",
      'import { db } from "@/db";\nexport const x = db;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("only src/lib/repositories/iq-*.ts and the engine mint an Observed quantity — barrel import", async () => {
    const ids = await ruleIdsFor(
      "lib/__fixtures__/minting-barrel.ts",
      'import { InsightSchema } from "@/lib/iq/engine";\nexport const x = InsightSchema;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("only src/lib/repositories/iq-*.ts and the engine mint an Observed quantity — aliased import", async () => {
    const ids = await ruleIdsFor(
      "lib/__fixtures__/minting-aliased.ts",
      'import { InsightSchema as Alias } from "@/lib/iq/engine";\nexport const x = Alias;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("only src/lib/repositories/iq-*.ts and the engine mint an Observed quantity — namespace import", async () => {
    const ids = await ruleIdsFor(
      "lib/__fixtures__/minting-namespace.ts",
      'import * as engine from "@/lib/iq/engine";\nexport const x = engine.InsightSchema;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("engine/quantity is banned as a deep import, same as observed-factory/insight/claims", async () => {
    const ids = await ruleIdsFor(
      "lib/__fixtures__/minting-quantity.ts",
      'import { ObservedSchema } from "@/lib/iq/engine/quantity";\nexport const x = ObservedSchema;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("job code may not import a repository outside the allowlist (an aliased import)", async () => {
    const ids = await ruleIdsFor(
      "lib/jobs/__fixtures__/allowlist-alias.ts",
      'import { listExpenses } from "@/lib/repositories/expenses";\nexport const x = listExpenses;\n',
    );
    expect(ids).toContain("import/no-restricted-paths");
  });

  it("job code may not import a repository outside the allowlist via a relative path", async () => {
    // Fixture lives at lib/jobs/__fixtures__/, so "../../repositories/..."
    // resolves to lib/repositories/... — same target the alias test above
    // reaches, by a different route.
    const ids = await ruleIdsFor(
      "lib/jobs/__fixtures__/allowlist-relative.ts",
      'import { capturePayment } from "../../repositories/payments";\nexport const x = capturePayment;\n',
    );
    expect(ids).toContain("import/no-restricted-paths");
  });

  it("job code allowlist permits an iq-* repository (no false positive)", async () => {
    const ids = await ruleIdsFor(
      "lib/jobs/__fixtures__/allowlist-ok.ts",
      'import { createJobRunStore } from "@/lib/repositories/iq-job-runs";\nexport const x = createJobRunStore;\n',
    );
    expect(ids).not.toContain("import/no-restricted-paths");
  });

  it("an individual job (src/lib/jobs/jobs/**) may not import even an iq-* repository directly", async () => {
    const ids = await ruleIdsFor(
      "lib/jobs/jobs/__fixtures__/no-repo.ts",
      'import { createJobRunStore } from "@/lib/repositories/iq-job-runs";\nexport const x = createJobRunStore;\n',
    );
    expect(ids).toContain("import/no-restricted-paths");
  });

  it("an individual job (src/lib/jobs/jobs/**) may not import @/db directly", async () => {
    const ids = await ruleIdsFor(
      "lib/jobs/jobs/__fixtures__/no-db.ts",
      'import { db } from "@/db";\nexport const x = db;\n',
    );
    expect(ids).toContain("import/no-restricted-paths");
  });

  // ARCHITECT re-review of ebc0987 (iq0-s9c, item b): a path-based allowlist
  // only constrains files under src/**, so a job could reach Postgres
  // directly through an npm package instead of a repository — this is
  // ARCHITECT's own probe (postgres + serverEnv().DATABASE_URL, zero
  // errors) verified fixed.
  it("job code may not import the postgres driver package directly", async () => {
    const ids = await ruleIdsFor(
      "lib/jobs/jobs/__fixtures__/db-package.ts",
      'import postgres from "postgres";\nexport const x = postgres;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("job code may not import a drizzle-orm subpath directly", async () => {
    const ids = await ruleIdsFor(
      "lib/jobs/__fixtures__/db-package-drizzle.ts",
      'import { eq } from "drizzle-orm/pg-core";\nexport const x = eq;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  it("job code may not import a @supabase/* package directly", async () => {
    const ids = await ruleIdsFor(
      "app/api/jobs/__fixtures__/db-package-supabase.ts",
      'import { createClient } from "@supabase/supabase-js";\nexport const x = createClient;\n',
    );
    expect(ids).toContain("no-restricted-imports");
  });

  // ARCHITECT re-review of ebc0987 (iq0-s9c, item a): only src/app/api/jobs
  // (deps.ts) reads a secret from src/lib/env; an individual job gets it
  // injected via JobContext.
  it("src/lib/jobs itself may not import src/lib/env directly", async () => {
    const ids = await ruleIdsFor(
      "lib/jobs/__fixtures__/no-env.ts",
      'import { serverEnv } from "@/lib/env";\nexport const x = serverEnv;\n',
    );
    expect(ids).toContain("import/no-restricted-paths");
  });

  it("src/app/api/jobs (deps.ts's job) may import src/lib/env (no false positive)", async () => {
    const ids = await ruleIdsFor(
      "app/api/jobs/__fixtures__/env-ok.ts",
      'import { serverEnv } from "@/lib/env";\nexport const x = serverEnv;\n',
    );
    expect(ids).not.toContain("import/no-restricted-paths");
  });

  // ARCHITECT re-review of ebc0987 (iq0-s9c, item c): the src/app/api/jobs
  // zone glob must work even though that directory does not exist in this
  // worktree yet (S8, agent/automation-architect-mu4xnv9l daa167f, not
  // merged) — a fixture proves the target isn't vacuously unmatched.
  it("src/app/api/jobs (the not-yet-merged job route) is covered by the allowlist even though the directory doesn't exist here yet", async () => {
    const ids = await ruleIdsFor(
      "app/api/jobs/__fixtures__/allowlist.ts",
      'import { listExpenses } from "@/lib/repositories/expenses";\nexport const x = listExpenses;\n',
    );
    expect(ids).toContain("import/no-restricted-paths");
  });

  // ARCHITECT re-review of aa24162 (iq0-s9d): merged with the real route
  // (agent/automation-architect-mu4xnv9l 45973ab), route.ts importing its
  // own ./deps failed lint — the route zone's exceptions covered what a
  // route may reach outside itself but never listed its own directory tree.
  it("the job route may import its own ./deps (no false positive)", async () => {
    const ids = await ruleIdsFor(
      "app/api/jobs/[job]/route.ts",
      'import { respondToJobRequest } from "@/lib/jobs/http";\nimport { jobRouteDeps } from "./deps";\nexport const x = { respondToJobRequest, jobRouteDeps };\n',
    );
    expect(ids).not.toContain("import/no-restricted-paths");
  });
});

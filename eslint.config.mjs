import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-plugin-import's no-restricted-paths resolves each import specifier
// to an absolute file path before matching it against a zone (so a relative
// import is checked exactly like an aliased one — no special-casing needed).
// For a glob-style `from`, `except` globs are matched against that same
// absolute path too, so every glob here is built from the repo root rather
// than left relative, which is otherwise a silent no-op (ARCHITECT review of
// daa167f, iq0-s9r item 2/3, verified against the plugin's own matching
// logic before relying on it).
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const abs = (p) => path.join(ROOT, p);

// IQ-0 DESIGN.md §3 / ARCHITECT review of daa167f (iq0-s9r item 3): a
// blocklist of specific repository names ("payments", "orders", "finance")
// lets every other money writer through (expenses, invoice, loyalty,
// delivery, stock, purchase-orders, promotions, idempotency, the payment
// provider registry itself). Job code gets an allowlist instead: only what
// it needs to do its job. @/lib/env is not in the ARCHITECT-specified list
// but is added here too — deps.ts (S8, agent/automation-architect-mu4xnv9l
// daa167f, not yet merged) reads JOB_SECRET through it, and that read was
// already fact-checked in the same review (item, "deps.ts:24-26").
const JOBS_LIB_MESSAGE =
  "src/lib/jobs may only import from itself, src/lib/iq, or src/lib/repositories/iq-* — not a general repository, alias, relative, or src/lib/env (secrets are injected via JobContext, not read directly — ARCHITECT review of daa167f, iq0-s9r item 3, and ebc0987, iq0-s9c item a).";
const JOBS_ROUTE_MESSAGE =
  "src/app/api/jobs may only import from itself, src/lib/jobs, src/lib/iq, src/lib/repositories/iq-*, or src/lib/env (deps.ts reads JOB_SECRET through it) — not a general repository, alias, or relative (ARCHITECT review of daa167f, iq0-s9r item 3, and 45973ab, iq0-s9d).";

const JOB_IMPLEMENTATION_DB_MESSAGE =
  "An individual job (src/lib/jobs/jobs/**, e.g. heartbeat) must reach the database only through ctx from its JobContext — no direct @/db or repository import, even an iq-* one (ARCHITECT review of daa167f, SECURITY condition).";

// ARCHITECT re-review of ebc0987 (iq0-s9c, item b): a path-based allowlist
// only constrains files under src/**, so a job could bypass every rule
// above by talking to Postgres directly through an npm package instead of a
// repository. This must be a `no-restricted-imports` block (paths are
// package names, not project files, so no-restricted-paths does not apply),
// and — same rule key as the minting block above, same files — it has to
// repeat that block's paths/patterns verbatim or lose them (the flat-config
// "last matching block wins wholesale" gotcha, hit twice already in this
// file's history).
const JOB_DB_PACKAGE_MESSAGE =
  "Job code (src/lib/jobs/**, src/app/api/jobs/**) may not import a database driver or client package directly — go through a repository or ctx (ARCHITECT review of ebc0987, iq0-s9c item b).";

// ARCHITECT re-review of ebc0987 (iq0-s9c, item a): only src/app/api/jobs
// (deps.ts) reads a secret from src/lib/env — an individual job gets its
// secrets injected via JobContext, so src/lib/jobs itself should not be able
// to read env directly either.
const JOBS_LIB_EXCEPT = ["src/lib/jobs/**", "src/lib/iq/**", "src/lib/repositories/iq-*.ts"];
// ARCHITECT re-review of aa24162 (iq0-s9d): merged with the real route
// (agent/automation-architect-mu4xnv9l 45973ab), route.ts importing its own
// ./deps failed lint — the route zone's exceptions covered everything a
// route may reach *outside* itself, but never listed the route's own
// directory tree, so route.ts (and deps.ts) fell into the same "banned
// unless excepted" bucket as any other src/** file.
const JOBS_ROUTE_EXCEPT = [...JOBS_LIB_EXCEPT, "src/app/api/jobs/**", "src/lib/env/**"];

// ARCHITECT review of accdd93 (P2 #1): a forecast figure can be passed off
// as a fact because every payload schema, InsightSchema, and ObservedSchema
// mint an Observed quantity on `.parse()`, not just the sanctioned paths —
// the engine's own "only observed-factory mints" comment
// (src/lib/iq/engine/index.ts) is therefore only true if nothing outside the
// engine imports these directly. ObservedSchema itself lives in quantity.ts
// (ARCHITECT review of daa167f, iq0-s9r item 1) — ban that deep import too,
// alongside observed-factory/insight/claims.
const ENGINE_MINTING_MESSAGE =
  "Only src/lib/repositories/iq-*.ts and the engine itself may import this — it mints an Observed quantity. Read a stored value through a repository instead (ARCHITECT review of accdd93, P2 #1).";
const ENGINE_MINTING_NAMES = [
  "ObservedSchema",
  "InsightSchema",
  "FactPayloadSchema",
  "DetectionPayloadSchema",
  "ForecastPayloadSchema",
  "ExplanationPayloadSchema",
  "RecommendationPayloadSchema",
  "AutomationPayloadSchema",
];
// ARCHITECT review of c27fbd1 (iq2-s2-arch P2): these iq-insights functions
// take no viewer, so they would show payment-ledger findings (recon.*, sig.*)
// to anyone. Code outside the repositories and jobs gets insights only
// through loadInsightsFor, which applies the finance.view gate. Added to the
// existing global block (same rule key: a separate block would override the
// minting ban for the same files).
const UNGATED_INSIGHT_READERS = ["listInsights", "getInsight", "writeInsight", "expireInsights", "readFactFigures"];
const UNGATED_INSIGHT_MESSAGE =
  "Read insights for a person through loadInsightsFor (finance.view gate); listInsights/getInsight/readFactFigures and the writers are for repositories and jobs only (ARCHITECT review of c27fbd1, iq2-s2-arch P2).";

const ENGINE_MINTING_MODULES = [
  "@/lib/iq/engine/observed-factory",
  "@/lib/iq/engine/insight",
  "@/lib/iq/engine/claims",
  "@/lib/iq/engine/quantity",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // IQ-0 DESIGN.md §3 / ARCHITECT review of S1 (accdd93): src/lib/iq/engine
    // is pure computation over stored facts — no DB, Next, or React import,
    // ever, from any file in it.
    files: ["src/lib/iq/engine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: "src/lib/iq/engine must stay pure: no Next.js imports." },
            { name: "react", message: "src/lib/iq/engine must stay pure: no React imports." },
            { name: "react-dom", message: "src/lib/iq/engine must stay pure: no React imports." },
            { name: "drizzle-orm", message: "src/lib/iq/engine must stay pure: no DB imports." },
            { name: "postgres", message: "src/lib/iq/engine must stay pure: no DB imports." },
            { name: "@/db", message: "src/lib/iq/engine must stay pure: no DB imports." },
          ],
          patterns: [
            {
              group: ["next/*", "@/db/*", "@/lib/repositories/*", "@/lib/supabase/*"],
              message: "src/lib/iq/engine must stay pure: no DB, Next.js, or React import.",
            },
          ],
        },
      ],
    },
  },
  {
    // ARCHITECT review of accdd93 (P2 #1) and daa167f (iq0-s9r item 1):
    // restrict who can mint an Observed quantity to the places already
    // reviewed for it — the engine itself, and the iq-* repositories that
    // read stored rows. One global rule, not duplicated per directory: this
    // is a different rule key than the job allowlist below, so the two
    // never fight over the same file the way two `no-restricted-imports`
    // blocks would (an ESLint flat-config gotcha found and fixed in this
    // file's first two commits — same rule key + overlapping `files` means
    // the later block wins wholesale, not a merge).
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/iq/engine/**",
      "src/lib/repositories/iq-*.ts",
      "src/lib/jobs/**",
      "src/app/api/jobs/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__test-support__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/iq/engine", importNames: ENGINE_MINTING_NAMES, message: ENGINE_MINTING_MESSAGE },
            { name: "@/lib/repositories/iq-insights", importNames: UNGATED_INSIGHT_READERS, message: UNGATED_INSIGHT_MESSAGE },
          ],
          patterns: [
            { group: ENGINE_MINTING_MODULES, message: ENGINE_MINTING_MESSAGE },
            { group: ["**/repositories/iq-insights"], importNames: UNGATED_INSIGHT_READERS, message: UNGATED_INSIGHT_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    // ARCHITECT re-review of ebc0987 (iq0-s9c, item b): job code (and
    // src/lib/jobs/jobs/** within it) still gets the same minting
    // restriction as everywhere else — repeated here, not layered, because
    // this block's `files` overlaps the one above for the exact same rule
    // key. Plus the new database-package ban (item b) that a path-based
    // allowlist alone cannot express.
    files: ["src/lib/jobs/**/*.{ts,tsx}", "src/app/api/jobs/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/__test-support__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/iq/engine", importNames: ENGINE_MINTING_NAMES, message: ENGINE_MINTING_MESSAGE },
            { name: "postgres", message: JOB_DB_PACKAGE_MESSAGE },
            { name: "pg", message: JOB_DB_PACKAGE_MESSAGE },
            { name: "drizzle-orm", message: JOB_DB_PACKAGE_MESSAGE },
          ],
          patterns: [
            { group: ENGINE_MINTING_MODULES, message: ENGINE_MINTING_MESSAGE },
            { group: ["drizzle-orm/*", "@supabase/*"], message: JOB_DB_PACKAGE_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    // IQ-0 DESIGN.md §3 / ARCHITECT review of daa167f (iq0-s9r items 2-3),
    // re-reviewed at ebc0987 (iq0-s9c, item a): the job runner runs
    // unattended, per org, with postgres bypassing RLS. An allowlist, not a
    // blocklist: only code job runs actually need. no-restricted-paths
    // resolves relative imports and aliases to the same absolute file
    // before matching a zone, so both are caught the same way (verified
    // against a scratch fixture before relying on it — a plain named-import
    // blocklist does not do this). Two target-specific zones, not one: only
    // src/app/api/jobs (deps.ts) reads a secret from src/lib/env — an
    // individual job gets it injected via JobContext, so src/lib/jobs
    // itself may not read env directly either.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: [abs("src/lib/jobs/**")],
              from: [abs("src/**")],
              except: JOBS_LIB_EXCEPT.map(abs),
              message: JOBS_LIB_MESSAGE,
            },
            {
              target: [abs("src/app/api/jobs/**")],
              from: [abs("src/**")],
              except: JOBS_ROUTE_EXCEPT.map(abs),
              message: JOBS_ROUTE_MESSAGE,
            },
            {
              // Stricter subzone: an individual job may not reach a
              // repository at all, not even the iq-* ones the outer zone
              // allows for wiring code (deps.ts) — it gets everything
              // through ctx.
              target: [abs("src/lib/jobs/jobs/**")],
              from: [abs("src/lib/repositories/**"), abs("src/db/**")],
              message: JOB_IMPLEMENTATION_DB_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reference copies that live in the tree but are not part of this build
    // (see .gitignore and tsconfig "exclude").
    "frybird-iq/**",
    "shadcn-ui-kit-dashboard/**",
    // Sibling agent worktrees under .claude/worktrees/<name>/.next — the bare
    // ".next/**" above only matches the repo-root build output, not one
    // nested inside a worktree. Left uncleaned, another worktree's own
    // `pnpm build` run pollutes a bare `pnpm lint` from this checkout with
    // thousands of unrelated errors from its compiled output. Each worktree
    // is its own checkout with its own lint run anyway, so its build output
    // was never in scope here.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;

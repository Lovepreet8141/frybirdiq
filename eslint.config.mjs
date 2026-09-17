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
const JOBS_ALLOWLIST_MESSAGE =
  "Job code (src/lib/jobs/**, src/app/api/jobs/**) may only import from itself, src/lib/iq, src/lib/repositories/iq-*, or src/lib/env — not a general repository, alias or relative (ARCHITECT review of daa167f, iq0-s9r item 3).";

const JOB_IMPLEMENTATION_DB_MESSAGE =
  "An individual job (src/lib/jobs/jobs/**, e.g. heartbeat) must reach the database only through ctx from its JobContext — no direct @/db or repository import, even an iq-* one (ARCHITECT review of daa167f, SECURITY condition).";

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
    ignores: ["src/lib/iq/engine/**", "src/lib/repositories/iq-*.ts", "**/*.test.ts", "**/*.test.tsx", "**/__test-support__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@/lib/iq/engine", importNames: ENGINE_MINTING_NAMES, message: ENGINE_MINTING_MESSAGE }],
          patterns: [{ group: ENGINE_MINTING_MODULES, message: ENGINE_MINTING_MESSAGE }],
        },
      ],
    },
  },
  {
    // IQ-0 DESIGN.md §3 / ARCHITECT review of daa167f (iq0-s9r items 2-3):
    // the job runner runs unattended, per org, with postgres bypassing RLS.
    // An allowlist, not a blocklist: only code job runs actually need.
    // no-restricted-paths resolves relative imports and aliases to the same
    // absolute file before matching a zone, so both are caught the same way
    // (verified against a scratch fixture before relying on it — a plain
    // named-import blocklist does not do this).
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: [abs("src/lib/jobs/**"), abs("src/app/api/jobs/**")],
              from: [abs("src/**")],
              except: [
                abs("src/lib/jobs/**"),
                abs("src/lib/iq/**"),
                abs("src/lib/repositories/iq-*.ts"),
                abs("src/lib/env/**"),
              ],
              message: JOBS_ALLOWLIST_MESSAGE,
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

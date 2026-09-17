import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// IQ-0 DESIGN.md §3: "jobs may not import payments/orders/finance writers
// (lint + import-scan test)." The import-scan half is
// src/lib/jobs/source-hygiene.test.ts.
const JOBS_MONEY_WRITER_MESSAGE =
  "src/lib/jobs and src/app/api/jobs may not import payments/orders/finance writers directly (IQ-0 DESIGN.md §3). Read through a repository the job owns.";

// ARCHITECT review of accdd93 (P2 #1): a forecast figure can be passed off as
// a fact because every payload schema and InsightSchema mint an Observed
// quantity on `.parse()`, not just the sanctioned paths — the engine's own
// "only observed-factory mints" comment (src/lib/iq/engine/index.ts) is
// therefore only true if nothing outside the engine imports these directly.
const ENGINE_MINTING_MESSAGE =
  "Only src/lib/repositories/iq-*.ts and the engine itself may import this — it mints an Observed quantity. Read a stored value through a repository instead (ARCHITECT review of accdd93, P2 #1).";

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
    // IQ-0 DESIGN.md §3: the job runner runs unattended, per org, with
    // postgres bypassing RLS — it must not be able to touch money writers a
    // job was never reviewed against, or mint its own Observed quantity
    // (same restriction as the general case below — combined here, not
    // layered, because flat config replaces a rule wholesale per matching
    // file rather than merging two blocks' `patterns` arrays together).
    files: ["src/lib/jobs/**/*.{ts,tsx}", "src/app/api/jobs/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/__test-support__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/iq/engine",
              importNames: [
                "ObservedSchema",
                "InsightSchema",
                "FactPayloadSchema",
                "DetectionPayloadSchema",
                "ForecastPayloadSchema",
                "ExplanationPayloadSchema",
                "RecommendationPayloadSchema",
                "AutomationPayloadSchema",
              ],
              message: ENGINE_MINTING_MESSAGE,
            },
          ],
          patterns: [
            {
              group: ["@/lib/repositories/payments", "@/lib/repositories/orders", "@/lib/repositories/finance"],
              message: JOBS_MONEY_WRITER_MESSAGE,
            },
            {
              group: ["@/lib/iq/engine/observed-factory", "@/lib/iq/engine/insight", "@/lib/iq/engine/claims"],
              message: ENGINE_MINTING_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // ARCHITECT review of accdd93 (P2 #1): restrict who can mint an Observed
    // quantity to the places already reviewed for it — the engine's own
    // parseInsights, and the iq-* repositories that read stored rows. Every
    // other file must go through a repository, not the schema directly.
    // (Jobs get this same restriction above, combined with their own.)
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
            {
              name: "@/lib/iq/engine",
              importNames: [
                "ObservedSchema",
                "InsightSchema",
                "FactPayloadSchema",
                "DetectionPayloadSchema",
                "ForecastPayloadSchema",
                "ExplanationPayloadSchema",
                "RecommendationPayloadSchema",
                "AutomationPayloadSchema",
              ],
              message: ENGINE_MINTING_MESSAGE,
            },
          ],
          patterns: [
            {
              group: ["@/lib/iq/engine/observed-factory", "@/lib/iq/engine/insight", "@/lib/iq/engine/claims"],
              message: ENGINE_MINTING_MESSAGE,
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

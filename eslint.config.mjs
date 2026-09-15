import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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

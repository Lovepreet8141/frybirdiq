import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // The financial core is pure TypeScript with no DOM and no framework
    // imports, so it runs in plain node. BUILD-PLAN.md §54.
    environment: "node",
    include: ["src/lib/**/*.test.ts", "src/domain/**/*.test.ts", "src/db/**/*.test.ts"],
    // *.integration.test.ts is a *.test.ts file too — this suite's own glob
    // would otherwise pick them up. They need a real Postgres and the
    // "react-server" resolve condition (vitest.integration.config.mts),
    // neither of which this fast, DB-free suite has; run them with
    // `pnpm test:integration` instead.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});

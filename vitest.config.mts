import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // The financial core is pure TypeScript with no DOM and no framework
    // imports, so it runs in plain node. BUILD-PLAN.md §54.
    environment: "node",
    include: ["src/lib/**/*.test.ts", "src/domain/**/*.test.ts", "src/db/**/*.test.ts"],
  },
});

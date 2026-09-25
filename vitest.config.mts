import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // The financial core is pure TypeScript with no DOM and no framework
    // imports, so it runs in plain node. BUILD-PLAN.md §54. Component tests
    // under src/components are included too, but only ever the plain-logic
    // kind (e.g. src/components/staff/delivery-close.test.ts, a pure
    // function test colocated with its component) — nothing here renders a
    // component or touches the DOM, so node stays the right environment for
    // all of it. A test that needs jsdom belongs in its own suite instead.
    environment: "node",
    include: ["src/lib/**/*.test.ts", "src/domain/**/*.test.ts", "src/db/**/*.test.ts", "src/components/**/*.test.{ts,tsx}"],
    // *.integration.test.ts is a *.test.ts file too — this suite's own glob
    // would otherwise pick them up. They need a real Postgres and the
    // "react-server" resolve condition (vitest.integration.config.mts),
    // neither of which this fast, DB-free suite has; run them with
    // `pnpm test:integration` instead. Same reasoning for *.dom.test.tsx —
    // it needs jsdom (vitest.dom.config.mts, `pnpm test:dom`), which this
    // node-environment suite doesn't have; it would otherwise "pass" the
    // include glob and fail every time for having no DOM, not for a real bug.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts", "**/*.dom.test.tsx"],
  },
});

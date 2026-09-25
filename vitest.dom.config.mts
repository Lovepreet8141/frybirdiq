import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * A jsdom suite, deliberately separate from the main one (vitest.config.mts
 * — "A test that needs jsdom belongs in its own suite instead"). Real DOM
 * timing — when React actually commits a value to a node, versus when a
 * synchronous event handler runs — is exactly the class of bug that a pure
 * node/logic test can't see at all: the stale-auto-submit incident (25 Sep
 * 2026, live customer sign-in broken) was only ever "live hand-tested," and
 * shipped anyway. This suite exists so that class of bug has an actual gate.
 *
 * Scoped tightly on purpose: only *.dom.test.tsx, not every component test,
 * so this stays the exception, not the default. Run with `pnpm test:dom`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["src/components/**/*.dom.test.tsx"],
    exclude: ["**/node_modules/**"],
    globals: false,
  },
});

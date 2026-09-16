import { defineConfig } from "vitest/config";

/**
 * The persistence/orchestration test suite — a separate config from
 * vitest.config.mts on purpose.
 *
 * The main suite runs pure src/lib and src/domain logic against nothing but
 * plain node, deliberately never touching a database. This one runs the
 * repository layer (withIdempotency, order placement, payment capture,
 * inventory consumption/reversal, stock receiving, loyalty reversal) for
 * real, against a real Postgres — the local, isolated stack `supabase
 * start` runs in Docker, never production. Run with `pnpm test:integration`,
 * not `pnpm test`.
 *
 * `resolve.conditions: ["react-server"]` is what makes this possible at
 * all: every repository file starts with `import "server-only"`, which
 * throws unconditionally unless resolved under this exact condition (the
 * one Next.js's own server-component bundler sets). Without it, none of
 * these files can even be imported outside a Next build.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: { resolve: { conditions: ["react-server"] } },
  test: {
    environment: "node",
    include: ["src/lib/repositories/**/*.integration.test.ts"],
    setupFiles: ["./vitest.integration.setup.ts"],
    // Sequential, not parallel: every test in this suite shares one real
    // database and mutates real rows (its own, freshly seeded, cleaned up
    // per file) — parallel workers would race each other's fixtures.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});

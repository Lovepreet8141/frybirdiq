import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output, for deploying to a VPS.
   *
   * Next traces exactly which files the server actually needs and copies them,
   * with a minimal node_modules, into `.next/standalone`. The result is a few
   * tens of megabytes instead of the whole dependency tree, which matters when
   * the target is a small box and the transfer is over a home connection.
   *
   * It also means the server runs with `node server.js` — no `next start`, no
   * pnpm, and no dev dependencies present in production at all.
   */
  output: "standalone",

  // Fail the production build on a type error rather than shipping it. Lint is
  // a separate gate; the deploy script runs it before building.
  typescript: { ignoreBuildErrors: false },

  // Do not advertise the framework and version to every visitor.
  poweredByHeader: false,
};

export default nextConfig;

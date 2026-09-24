import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { NextConfig } from "next";

/**
 * One opaque id per build, shared by the server and the browser bundle.
 *
 * The staff screens compare the id baked into their own bundle with what
 * `/api/version` says the running server has, and offer a reload when they
 * differ (deploy.sh restarts the process, so a screen left open across a deploy
 * keeps running the old client). Derived from the commit so every config
 * evaluation inside one build agrees, hashed so the URL does not publish the
 * commit. Not a secret; just not the commit hash itself.
 */
function buildId(): string {
  let source = "dev";
  try {
    const git = (args: string) => execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString();
    // The commit AND anything uncommitted: deploy.sh ships the working tree, so a
    // rebuild of the same commit with edits must not look like the same build.
    source = `${git("rev-parse HEAD").trim()}|${createHash("sha256").update(git("diff HEAD")).update(git("status --porcelain")).digest("hex")}`;
  } catch {
    // No git (an unpacked tarball): every build then shares "dev" and the check stays quiet.
  }
  return createHash("sha256").update(`frybird:${source}`).digest("hex").slice(0, 16);
}
const BUILD_ID = buildId();

const nextConfig: NextConfig = {
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },

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

  /**
   * The Menu Manager's media library stores photos in Supabase Storage, on
   * this project's own subdomain — `next/image` refuses any remote host that
   * is not explicitly allow-listed, so a photo picked there would otherwise
   * 400 rather than render.
   */
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
    /**
     * Sized for what the site actually shows. The product photos are 640 px
     * wide at source and drawn at most ~350 px (cards) or 640 px (item page),
     * so the default ladder up to 3840 px only ever produced upscaled, heavier
     * files (the menu's <img src> was the 3840w one). AVIF first, WebP after.
     */
    deviceSizes: [384, 640, 750, 828, 1080],
    imageSizes: [96, 160, 256, 340],
    formats: ["image/avif", "image/webp"],
    // Optimised copies are reused for 30 days instead of the 60 s default.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  /**
   * Cache headers for the site's own static media. These files are not
   * content-hashed, so a year-long `immutable` would pin a replaced photo;
   * a day fresh plus a week of stale-while-revalidate keeps repeat visits off
   * the network and still picks up a new file within a day.
   */
  async headers() {
    const media = "public, max-age=86400, stale-while-revalidate=604800";
    // Assets embedded in an outbound email (the login-code email's logo,
    // docs/email-templates/login.html): fetched once per email client, often
    // long after the email was sent, so a much longer cache pays off — still
    // not `immutable`, since the filename is not content-hashed and could be
    // replaced without changing the URL.
    const email = "public, max-age=2592000, stale-while-revalidate=2592000";
    return [
      ...["/home/:path*", "/hero/:path*", "/products/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: media }] })),
      { source: "/email/:path*", headers: [{ key: "Cache-Control", value: email }] },
    ];
  },
};

export default nextConfig;

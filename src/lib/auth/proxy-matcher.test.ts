import { describe, expect, it } from "vitest";
import * as staticInfo from "next/dist/build/analysis/get-page-static-info";
import type { ProxyMatcher } from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import type { NextConfig } from "next";
import { config } from "@/proxy";

// Exported at runtime but left out of Next's type declarations.
const { getMiddlewareMatchers } = staticInfo as unknown as {
  getMiddlewareMatchers: (matcher: string[], nextConfig: NextConfig) => ProxyMatcher[];
};

/**
 * Which paths src/proxy.ts runs on, compiled by Next's own matcher code rather
 * than a hand-written copy of the regex, so the test cannot agree with a
 * pattern Next reads differently.
 */
const matches = (() => {
  const match = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
  // The request is only read for `has`/`missing` conditions, which this matcher has none of.
  const noRequest = undefined as unknown as Parameters<typeof match>[1];
  return (pathname: string) => match(pathname, noRequest, {});
})();

describe("proxy matcher", () => {
  it("skips the scheduled-job routes", () => {
    expect(matches("/api/jobs/heartbeat")).toBe(false);
    expect(matches("/api/jobs")).toBe(false);
    expect(matches("/api/jobs/")).toBe(false);
    expect(matches("/api/jobs/heartbeat.rsc")).toBe(false);
  });

  it("still runs on paths that only start with the same letters", () => {
    expect(matches("/api/jobsx")).toBe(true);
    expect(matches("/api/jobsx/heartbeat")).toBe(true);
    expect(matches("/api/job")).toBe(true);
  });

  it("still runs on staff, account and other API routes", () => {
    expect(matches("/app")).toBe(true);
    expect(matches("/app/iq")).toBe(true);
    expect(matches("/account")).toBe(true);
    expect(matches("/api/public/menu")).toBe(true);
    expect(matches("/")).toBe(true);
  });

  it("still skips static assets", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/logo.svg")).toBe(false);
  });
});

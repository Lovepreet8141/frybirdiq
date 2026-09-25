import { describe, expect, it, vi } from "vitest";

// src/proxy.ts now imports src/lib/auth/remember-me.ts (auth-v2), which is "server-only" — this test only
// needs the static `config.matcher` export, so the module's runtime auth logic is irrelevant here.
vi.mock("server-only", () => ({}));

import { config } from "@/proxy";

// The matcher is the whole rule for which paths pay for a Supabase session refresh.
const pattern = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it.each(["/api/health", "/api/health/", "/api/jobs/facts", "/favicon.ico"])("skips %s", (path) => {
    expect(pattern.test(path)).toBe(false);
  });

  it.each(["/", "/menu", "/app/admin", "/api/healthz", "/api/jobsx", "/api/payments/webhook"])("still runs on %s", (path) => {
    expect(pattern.test(path)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

// The matcher is the whole rule for which paths pay for a Supabase session refresh.
const pattern = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it.each(["/api/health", "/api/health/", "/api/jobs/facts", "/favicon.ico", "/api/whatsapp/webhook", "/api/whatsapp/webhook/"])("skips %s", (path) => {
    expect(pattern.test(path)).toBe(false);
  });

  it.each(["/", "/menu", "/app/admin", "/api/healthz", "/api/jobsx", "/api/payments/webhook", "/api/whatsapp/webhookx", "/api/whatsapp"])("still runs on %s", (path) => {
    expect(pattern.test(path)).toBe(true);
  });
});

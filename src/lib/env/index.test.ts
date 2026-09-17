import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serverEnv } from "./index";

/*
 * JOB_SECRET and JOB_SECRET_PREVIOUS gate `/api/jobs/[job]` (hive DESIGN.md
 * §3). Unset means the job runner is dormant, so `serverEnv()` must not
 * throw when they are absent — only a value that is present but too short
 * to be a real secret is a config mistake worth failing on.
 */
describe("serverEnv JOB_SECRET / JOB_SECRET_PREVIOUS", () => {
  const REQUIRED = {
    DATABASE_URL: "postgres://localhost:5432/test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  };
  const VALID_SECRET = "a".repeat(32);
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    JOB_SECRET: process.env.JOB_SECRET,
    JOB_SECRET_PREVIOUS: process.env.JOB_SECRET_PREVIOUS,
  };

  beforeEach(() => {
    process.env.DATABASE_URL = REQUIRED.DATABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = REQUIRED.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.JOB_SECRET;
    delete process.env.JOB_SECRET_PREVIOUS;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("is dormant (undefined, no throw) when both are unset", () => {
    const env = serverEnv();
    expect(env.JOB_SECRET).toBeUndefined();
    expect(env.JOB_SECRET_PREVIOUS).toBeUndefined();
  });

  it("treats an empty string the same as unset", () => {
    process.env.JOB_SECRET = "";
    process.env.JOB_SECRET_PREVIOUS = "";
    const env = serverEnv();
    expect(env.JOB_SECRET).toBeUndefined();
    expect(env.JOB_SECRET_PREVIOUS).toBeUndefined();
  });

  it("accepts a 32+ character secret", () => {
    process.env.JOB_SECRET = VALID_SECRET;
    process.env.JOB_SECRET_PREVIOUS = VALID_SECRET;
    const env = serverEnv();
    expect(env.JOB_SECRET).toBe(VALID_SECRET);
    expect(env.JOB_SECRET_PREVIOUS).toBe(VALID_SECRET);
  });

  it("rejects JOB_SECRET shorter than 32 characters", () => {
    process.env.JOB_SECRET = "too-short";
    expect(() => serverEnv()).toThrow(/JOB_SECRET/);
  });

  it("rejects JOB_SECRET_PREVIOUS shorter than 32 characters", () => {
    process.env.JOB_SECRET_PREVIOUS = "too-short";
    expect(() => serverEnv()).toThrow(/JOB_SECRET_PREVIOUS/);
  });
});

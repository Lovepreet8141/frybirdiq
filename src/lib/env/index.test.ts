import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serverEnv } from "./index";

const REQUIRED = {
  DATABASE_URL: "postgres://localhost:5432/test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};
const VALID_SECRET = "a".repeat(32);

/*
 * JOB_SECRET and JOB_SECRET_PREVIOUS gate `/api/jobs/[job]` (hive DESIGN.md
 * §3). Unset means the job runner is dormant, so `serverEnv()` must not
 * throw when they are absent — only a value that is present but too short,
 * or containing whitespace / non-ASCII, is a config mistake worth failing
 * on (the latter per the S8 red-team note: such a secret can never match
 * the bearer token at runtime, so it should fail loudly at startup instead
 * of failing closed silently forever).
 */
describe("serverEnv JOB_SECRET / JOB_SECRET_PREVIOUS", () => {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, JOB_SECRET: process.env.JOB_SECRET, JOB_SECRET_PREVIOUS: process.env.JOB_SECRET_PREVIOUS };

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

  it.each([
    ["a leading space", ` ${VALID_SECRET.slice(1)}`],
    ["a trailing newline", `${VALID_SECRET}\n`],
    ["an internal tab", `${VALID_SECRET.slice(0, 16)}\t${VALID_SECRET.slice(17)}`],
    ["a non-ASCII character", `${VALID_SECRET.slice(0, 31)}é`],
  ])("rejects JOB_SECRET containing %s", (_label, value) => {
    process.env.JOB_SECRET = value;
    expect(() => serverEnv()).toThrow(/JOB_SECRET/);
  });

  it("rejects JOB_SECRET_PREVIOUS containing whitespace", () => {
    process.env.JOB_SECRET_PREVIOUS = `${VALID_SECRET} `;
    expect(() => serverEnv()).toThrow(/JOB_SECRET_PREVIOUS/);
  });

  it("never echoes the rejected value in the thrown message", () => {
    const secret = `${VALID_SECRET.slice(0, 31)}UNMISTAKABLE_MARKER`;
    process.env.JOB_SECRET = secret;
    try {
      serverEnv();
      expect.unreachable("expected serverEnv() to throw");
    } catch (error) {
      expect(String(error)).not.toContain("UNMISTAKABLE_MARKER");
    }
  });
});

/*
 * DEPLOY_COMMIT is written into iq_job_runs.code_version
 * (src/app/api/jobs/[job]/deps.ts). Optional until DEVOPS-RELEASE's
 * deploy.sh writes it; when present it must be a real 40-character git SHA,
 * not an arbitrary label.
 */
describe("serverEnv DEPLOY_COMMIT", () => {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, DEPLOY_COMMIT: process.env.DEPLOY_COMMIT };

  beforeEach(() => {
    process.env.DATABASE_URL = REQUIRED.DATABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = REQUIRED.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.DEPLOY_COMMIT;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("is undefined, no throw, when unset", () => {
    expect(serverEnv().DEPLOY_COMMIT).toBeUndefined();
  });

  it("treats an empty string the same as unset", () => {
    process.env.DEPLOY_COMMIT = "";
    expect(serverEnv().DEPLOY_COMMIT).toBeUndefined();
  });

  it("accepts a 40-character lowercase hex sha", () => {
    const sha = "a".repeat(40);
    process.env.DEPLOY_COMMIT = sha;
    expect(serverEnv().DEPLOY_COMMIT).toBe(sha);
  });

  it.each([
    ["short (7-char abbreviation)", "1086608"],
    ["uppercase hex", "A".repeat(40)],
    ["the wrong alphabet", "g".repeat(40)],
    ["too long", "a".repeat(41)],
  ])("rejects %s", (_label, value) => {
    process.env.DEPLOY_COMMIT = value;
    expect(() => serverEnv()).toThrow(/DEPLOY_COMMIT/);
  });
});

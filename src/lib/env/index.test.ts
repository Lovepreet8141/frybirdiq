import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieSecret, serverEnv } from "./index";

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
 * deploy.sh writes it. Unlike JOB_SECRET, it gates nothing — SECURITY-TENANCY
 * flagged (be-1r) that a malformed value must never throw and take the whole
 * app down. An invalid shape is treated as unset (code_version falls back to
 * "unversioned" at the call site) with a single console.warn that never
 * prints the value.
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
    vi.restoreAllMocks();
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
    ["a trailing newline", `${"a".repeat(40)}\n`],
  ])("falls back to undefined (no throw) for %s", (_label, value) => {
    process.env.DEPLOY_COMMIT = value;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => serverEnv()).not.toThrow();
    expect(serverEnv().DEPLOY_COMMIT).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("never echoes the invalid value in the warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DEPLOY_COMMIT = "UNMISTAKABLE_MARKER".repeat(2);
    serverEnv();
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("UNMISTAKABLE_MARKER");
  });

  it("does not affect JOB_SECRET's fail-closed behaviour", () => {
    process.env.DEPLOY_COMMIT = "not-a-sha";
    process.env.JOB_SECRET = "too-short";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => serverEnv()).toThrow(/JOB_SECRET/);
    delete process.env.JOB_SECRET;
  });
});

describe("cookieSecret (cookie-sign-1)", () => {
  const set = (value: string | undefined) => {
    if (value === undefined) delete process.env.COOKIE_SECRET;
    else process.env.COOKIE_SECRET = value;
  };
  afterEach(() => set(undefined));

  it("unset or blank means none: the cookie stays plain JSON", () => {
    set(undefined);
    expect(cookieSecret()).toEqual({ kind: "none" });
    set("");
    expect(cookieSecret()).toEqual({ kind: "none" });
  });

  it("a good secret (32+ printable characters, no spaces) is ok", () => {
    set("a".repeat(64));
    expect(cookieSecret()).toEqual({ kind: "ok", secret: "a".repeat(64) });
  });

  it("a malformed secret is INVALID, never 'none': the cookie is treated as absent and checkout keeps working (it must not throw)", () => {
    for (const bad of ["short", "a".repeat(31), "a".repeat(40) + " ", "a".repeat(40) + "\n", "é".repeat(40)]) {
      set(bad);
      expect(() => cookieSecret()).not.toThrow();
      expect(cookieSecret(), JSON.stringify(bad)).toEqual({ kind: "invalid" });
    }
  });

  it("a bad COOKIE_SECRET does not break serverEnv(): checkout and order pages need the rest of the environment, not this", () => {
    const saved = { d: process.env.DATABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
    process.env.DATABASE_URL = REQUIRED.DATABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = REQUIRED.SUPABASE_SERVICE_ROLE_KEY;
    try {
      set("bad secret");
      expect(() => serverEnv()).not.toThrow();
    } finally {
      if (saved.d === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.d;
      if (saved.k === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.k;
    }
  });
});

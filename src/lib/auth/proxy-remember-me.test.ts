import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Drives the real `proxy()` (`src/proxy.ts`, the session-refresh middleware)
 * against a mocked `@supabase/ssr` that behaves like a genuine token
 * refresh — calls `setAll` with the library's own literal 400-day default,
 * exactly as the real client does — and checks what actually lands on the
 * response. This is the case `remember-me.test.ts`'s unit tests can't
 * cover: they test `withRememberMaxAge` in isolation, this proves the
 * wiring in `proxy.ts` itself applies it, on an ordinary background
 * refresh, not only at login.
 */

const mocks = vi.hoisted(() => ({ cookieSecret: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  clientEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key" }),
  isSupabaseConfigured: () => true,
  cookieSecret: mocks.cookieSecret,
}));

const LIBRARY_DEFAULT_MAX_AGE = 400 * 24 * 60 * 60;

vi.mock("@supabase/ssr", () => ({
  // Stands in for a real refresh: touching getUser() writes a session cookie back, exactly like the real
  // client does — with @supabase/ssr's own literal 400-day default, the same sentinel withRememberMaxAge
  // keys off. If proxy.ts stopped calling setAll's rewrite, these tests would see 400 days on the response.
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (list: unknown[]) => void } }) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll([
          {
            name: "sb-project-auth-token",
            value: "refreshed-session-value",
            options: { maxAge: LIBRARY_DEFAULT_MAX_AGE, path: "/", sameSite: "lax" as const },
          },
        ]);
        return { data: { user: { id: "u1" } } };
      },
    },
  }),
}));

import { proxy } from "@/proxy";
import { REMEMBER_COOKIE_NAME, REMEMBER_MAX_AGE, encodeRememberChoice } from "./remember-me";

const secret = "s".repeat(40);

function requestWithCookie(cookieHeader: string | null): NextRequest {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest("https://frybirdiq.tech/menu", { headers });
}

describe("proxy — remember-me survives a real middleware refresh", () => {
  beforeEach(() => mocks.cookieSecret.mockReset());

  it("unticked: the refreshed session cookie has no maxAge at all — a true session cookie", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const marker = encodeRememberChoice(false)!;
    const request = requestWithCookie(`${REMEMBER_COOKIE_NAME}=${marker}`);

    const response = await proxy(request);

    const session = response.cookies.get("sb-project-auth-token");
    expect(session).toBeDefined();
    expect(session?.maxAge).toBeUndefined();
  });

  it("ticked: the refreshed session cookie gets exactly 30 days, and the marker itself rolls forward with it", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const marker = encodeRememberChoice(true)!;
    const request = requestWithCookie(`${REMEMBER_COOKIE_NAME}=${marker}`);

    const response = await proxy(request);

    const session = response.cookies.get("sb-project-auth-token");
    expect(session?.maxAge).toBe(REMEMBER_MAX_AGE);

    // The signed value is deterministic for the same payload (no nonce/timestamp), so an identical value is
    // correct here, not stale — what actually rolls forward is the cookie's own maxAge, checked above.
    const rolledMarker = response.cookies.get(REMEMBER_COOKIE_NAME);
    expect(rolledMarker?.maxAge).toBe(REMEMBER_MAX_AGE);
    expect(rolledMarker?.value).toBe(marker);
  });

  it("no marker at all (a session that predates this mechanism): defaults to remembered, not cut short", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const request = requestWithCookie(null);

    const response = await proxy(request);

    const session = response.cookies.get("sb-project-auth-token");
    expect(session?.maxAge).toBe(REMEMBER_MAX_AGE);
  });

  it("a wrongly signed marker (tampered or stale secret) fails closed to session-only, not remembered", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    const marker = encodeRememberChoice(true)!;
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret: "a different secret padded to length".padEnd(40, "x") });
    const request = requestWithCookie(`${REMEMBER_COOKIE_NAME}=${marker}`);

    const response = await proxy(request);

    const session = response.cookies.get("sb-project-auth-token");
    expect(session?.maxAge).toBeUndefined();
  });
});

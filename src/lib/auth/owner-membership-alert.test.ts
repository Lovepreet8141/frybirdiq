import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * alert-owner-created: an OWNER membership arriving (created or reactivated)
 * must always produce a human-visible alert — the journal when ALERT_URL is
 * unset, the configured channel once it is — and must never throw, since a
 * delivery failure must not turn an allowed OWNER invite into a 500.
 */

const mocks = vi.hoisted(() => ({ serverEnv: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

import { sendOwnerMembershipAlert } from "./owner-membership-alert";

const orgId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";

describe("sendOwnerMembershipAlert", () => {
  beforeEach(() => {
    mocks.serverEnv.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes to the journal (console.error) and never touches the network when ALERT_URL is unset", async () => {
    mocks.serverEnv.mockReturnValue({ ALERT_URL: undefined });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await sendOwnerMembershipAlert("created", orgId, userId);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("OWNER membership created"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(orgId));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(userId));
  });

  it("POSTs to ALERT_URL when set, and never logs the URL itself", async () => {
    const url = "https://ntfy.sh/some-secret-topic";
    mocks.serverEnv.mockReturnValue({ ALERT_URL: url });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendOwnerMembershipAlert("reactivated", orgId, userId);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("OWNER membership reactivated");
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(url));
  });

  it("falls back to the journal, never throws, when the channel refuses the alert", async () => {
    mocks.serverEnv.mockReturnValue({ ALERT_URL: "https://ntfy.sh/topic" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(sendOwnerMembershipAlert("created", orgId, userId)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));
  });

  it("falls back to the journal, never throws, when the network call itself fails", async () => {
    mocks.serverEnv.mockReturnValue({ ALERT_URL: "https://ntfy.sh/topic" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(sendOwnerMembershipAlert("created", orgId, userId)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });
});

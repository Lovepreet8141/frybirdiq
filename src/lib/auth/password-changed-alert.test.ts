/**
 * recordPasswordChangedAndAlert (auth-v2, item 3): must write an audit row
 * REGARDLESS of whether ALERT_URL is set, and must never throw back into
 * the caller — a DB hiccup or an unreachable ALERT_URL must never look like
 * the password reset itself failed, since this always runs after
 * `updateUser({ password })` has already succeeded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ values: vi.fn(), insert: vi.fn(), fetch: vi.fn() }));

vi.mock("@/db", () => ({ db: () => ({ insert: mocks.insert }) }));
vi.mock("@/db/schema", () => ({ auditLogs: { __marker: "auditLogs" } }));

import { recordPasswordChangedAndAlert } from "./password-changed-alert";

const event = { orgId: "org-1", userId: "user-1", email: "owner@example.test" };

beforeEach(() => {
  mocks.values.mockReset().mockResolvedValue(undefined);
  mocks.insert.mockReset().mockReturnValue({ values: mocks.values });
  mocks.fetch.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.ALERT_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ALERT_URL;
});

describe("the audit row", () => {
  it("is written with the actor, action and entity that identify a password change", async () => {
    await recordPasswordChangedAndAlert(event);
    expect(mocks.insert).toHaveBeenCalledWith({ __marker: "auditLogs" });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        actorUserId: "user-1",
        action: "password_changed",
        entity: "auth_users",
        entityId: "user-1",
      }),
    );
  });

  it("is written even when ALERT_URL is unset — the audit row is never conditional on the alert channel", async () => {
    await recordPasswordChangedAndAlert(event);
    expect(mocks.values).toHaveBeenCalledTimes(1);
  });

  it("is written even when ALERT_URL IS set", async () => {
    process.env.ALERT_URL = "https://alerts.example.test/push";
    await recordPasswordChangedAndAlert(event);
    expect(mocks.values).toHaveBeenCalledTimes(1);
  });

  it("a failure to write the audit row never throws back into the caller", async () => {
    mocks.values.mockRejectedValue(new Error("db unreachable"));
    await expect(recordPasswordChangedAndAlert(event)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("failed to write the audit row"), expect.any(Error));
  });
});

describe("the owner alert", () => {
  it("falls back to a loud console.error line — never silent — when ALERT_URL is unset", async () => {
    await recordPasswordChangedAndAlert(event);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("ALERT [password_changed]"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("owner@example.test"));
  });

  it("POSTs to ALERT_URL when configured, with the account and a timestamp, never the password itself", async () => {
    process.env.ALERT_URL = "https://alerts.example.test/push";
    await recordPasswordChangedAndAlert(event);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://alerts.example.test/push",
      expect.objectContaining({ method: "POST" }),
    );
    const body = String(mocks.fetch.mock.calls[0]?.[1]?.body ?? "");
    expect(body).toContain("owner@example.test");
    expect(body).toMatch(/At: \d{4}-\d{2}-\d{2}T/); // an ISO timestamp — a real "when", not just "who"
  });

  it("a failed POST to ALERT_URL is logged, never thrown — the reset that already succeeded must not look failed", async () => {
    process.env.ALERT_URL = "https://alerts.example.test/push";
    mocks.fetch.mockRejectedValue(new Error("network down"));
    await expect(recordPasswordChangedAndAlert(event)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("failed to POST to ALERT_URL"), expect.any(Error));
  });

  it("never blocks or fails even when BOTH the audit write and the alert fail", async () => {
    process.env.ALERT_URL = "https://alerts.example.test/push";
    mocks.values.mockRejectedValue(new Error("db unreachable"));
    mocks.fetch.mockRejectedValue(new Error("network down"));
    await expect(recordPasswordChangedAndAlert(event)).resolves.toBeUndefined();
  });
});

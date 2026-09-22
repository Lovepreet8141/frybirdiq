import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * cookie-secret-dependency: with COOKIE_SECRET unset or invalid there is no unsigned fallback any more. A remembered
 * cookie is treated as entirely absent (never a bare phone number) and the misconfiguration is logged, loudly, every
 * time a cookie was actually there to be read or written.
 */

const mocks = vi.hoisted(() => ({
  cookieSecret: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ cookieSecret: mocks.cookieSecret }));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: mocks.get, set: mocks.set })) }));

import { encodeContactCookie } from "./contact-cookie";
import { readRememberedContact, rememberContact } from "./remembered-contact";

const secret = "s".repeat(40);
const contact = { name: "Asha Verma", phone: "9000000001", email: "asha@example.test" };
const orderId = "00000000-0000-4000-8000-000000000001";

describe("readRememberedContact", () => {
  beforeEach(() => {
    mocks.cookieSecret.mockReset();
    mocks.get.mockReset();
    mocks.set.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns null with no cookie present, and never alerts — an ordinary anonymous visit", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "none" });
    mocks.get.mockReturnValue(undefined);
    expect(await readRememberedContact()).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails closed and alerts when COOKIE_SECRET is unset but a cookie is present: no unsigned fallback", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "none" });
    mocks.get.mockReturnValue({ value: JSON.stringify({ ...contact, orders: [orderId] }) });
    expect(await readRememberedContact()).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("COOKIE_SECRET is unset"));
  });

  it("fails closed and alerts when COOKIE_SECRET is invalid", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "invalid" });
    mocks.get.mockReturnValue({ value: "v1.x.y" });
    expect(await readRememberedContact()).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("COOKIE_SECRET is invalid"));
  });

  it("reads a correctly signed cookie and never trusts a wrongly signed one", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    mocks.get.mockReturnValue({ value: encodeContactCookie({ ...contact, orders: [orderId] }, secret) });
    expect(await readRememberedContact()).toEqual({ ...contact, orderIds: [orderId] });

    mocks.get.mockReturnValue({ value: encodeContactCookie({ ...contact, orders: [orderId] }, "different secret padded to length".padEnd(40, "x")) });
    expect(await readRememberedContact()).toBeNull();
  });
});

describe("rememberContact", () => {
  beforeEach(() => {
    mocks.cookieSecret.mockReset();
    mocks.get.mockReset();
    mocks.set.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes nothing and alerts when COOKIE_SECRET is unset — no unsigned cookie is ever issued", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "none" });
    await rememberContact(contact);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("COOKIE_SECRET is unset"));
  });

  it("writes nothing and alerts when COOKIE_SECRET is invalid", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "invalid" });
    await rememberContact(contact);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("COOKIE_SECRET is invalid"));
  });

  it("writes a signed cookie carrying this order's id when the secret is set", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    mocks.get.mockReturnValue(undefined);
    await rememberContact(contact, orderId);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = mocks.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("frybird_contact");
    expect(value.startsWith("v1.")).toBe(true);
    expect(options.httpOnly).toBe(true);
  });

  it("silently drops an invalid contact shape without writing anything", async () => {
    mocks.cookieSecret.mockReturnValue({ kind: "ok", secret });
    await rememberContact({ name: "" });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

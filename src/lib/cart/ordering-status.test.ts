import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getOrg: vi.fn(), getOrderingStatus: vi.fn() }));

vi.mock("server-only", () => ({}));
// `cache` memoises per request; in a unit test each call must run for real.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/repositories/org", () => ({ getOrg: mocks.getOrg }));
vi.mock("@/lib/repositories/shop-status", () => ({ getOrderingStatus: mocks.getOrderingStatus }));

import { getCustomerOrderingStatus } from "./ordering-status";

beforeEach(() => {
  mocks.getOrg.mockReset();
  mocks.getOrderingStatus.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getCustomerOrderingStatus — the banner is on every page, so it must not take a page down (S5 refusal fix)", () => {
  it("returns the status the gate read", async () => {
    mocks.getOrg.mockResolvedValue({ id: "org-1" });
    mocks.getOrderingStatus.mockResolvedValue({ state: "open", closesAt: "23:00" });
    expect(await getCustomerOrderingStatus()).toEqual({ state: "open", closesAt: "23:00" });
    expect(mocks.getOrderingStatus).toHaveBeenCalledWith("org-1");
  });

  it("a failed status read resolves to null instead of throwing", async () => {
    mocks.getOrg.mockResolvedValue({ id: "org-1" });
    mocks.getOrderingStatus.mockRejectedValue(new Error("connection reset"));
    await expect(getCustomerOrderingStatus()).resolves.toBeNull();
  });

  it("a failed shop lookup resolves to null instead of throwing", async () => {
    mocks.getOrg.mockRejectedValue(new Error("timeout"));
    await expect(getCustomerOrderingStatus()).resolves.toBeNull();
  });

  it("no shop row is null, and reads no status", async () => {
    mocks.getOrg.mockResolvedValue(null);
    expect(await getCustomerOrderingStatus()).toBeNull();
    expect(mocks.getOrderingStatus).not.toHaveBeenCalled();
  });
});

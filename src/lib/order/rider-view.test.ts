import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn(),
  getCustomer: vi.fn(),
  readRememberedContact: vi.fn(),
  getOrg: vi.fn(),
  getRiderTrackingView: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/repositories/orders", () => ({ getOrder: mocks.getOrder }));
vi.mock("@/lib/customer", () => ({ getCustomer: mocks.getCustomer }));
vi.mock("@/lib/cart/remembered-contact", () => ({ readRememberedContact: mocks.readRememberedContact }));
vi.mock("@/lib/repositories/org", () => ({ getOrg: mocks.getOrg }));
vi.mock("@/lib/repositories/rider-tracking", () => ({ getRiderTrackingView: mocks.getRiderTrackingView }));

import { riderViewForViewer } from "./rider-view";

const id = "7d9f2c1e-4b3a-4c5d-8e6f-1a2b3c4d5e6f";
const call = (orderId = id) => riderViewForViewer(orderId);
const order = { id, customerPhone: "9000000001", customerEmail: null };
const view = { state: { kind: "live", ageSeconds: 4 }, rider: { lat: 30.4, lng: 76.8, recordedAt: new Date("2026-09-22T10:00:00Z") }, destination: { lat: 30.39, lng: 76.79 }, shop: { lat: 30.378, lng: 76.776 } };

describe("riderViewForViewer", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.getOrg.mockResolvedValue({ id: "org-1" });
    mocks.getOrder.mockResolvedValue(order);
    mocks.getCustomer.mockResolvedValue(null);
    mocks.readRememberedContact.mockResolvedValue({ phone: "9000000001", name: "A", email: "a@b.co", orderIds: [id] });
    mocks.getRiderTrackingView.mockResolvedValue(view);
  });

  it("answers the person who placed the order with the newest fix, uncached", async () => {
    expect(await call()).toEqual({
      state: "live",
      ageSeconds: 4,
      rider: { lat: 30.4, lng: 76.8, at: "2026-09-22T10:00:00.000Z" },
      destination: { lat: 30.39, lng: 76.79 },
      shop: { lat: 30.378, lng: 76.776 },
    });
    expect(mocks.getRiderTrackingView).toHaveBeenCalledWith({ orgId: "org-1", orderId: id });
  });

  it("answers someone who only knows the link with an empty 404, and never reads the rider", async () => {
    mocks.readRememberedContact.mockResolvedValue(null);
    expect(await call()).toBeNull();
    expect(mocks.getRiderTrackingView).not.toHaveBeenCalled();
  });

  it("a cookie that vouches for other orders does not vouch for this one", async () => {
    mocks.readRememberedContact.mockResolvedValue({ phone: "9000000001", name: "A", email: "a@b.co", orderIds: ["00000000-0000-4000-8000-000000000001"] });
    expect(await call()).toBeNull();
    expect(mocks.getRiderTrackingView).not.toHaveBeenCalled();
  });

  it("unknown and malformed ids look identical to a stranger's", async () => {
    mocks.getOrder.mockResolvedValue(null);
    expect(await call()).toBeNull();
    expect(await call("not-a-uuid")).toBeNull();
    expect(mocks.getOrder).toHaveBeenCalledTimes(1); // the malformed id never reached the database
  });

  it("passes 'hidden' through without coordinates when the order is not out", async () => {
    mocks.getRiderTrackingView.mockResolvedValue({ state: { kind: "hidden" }, rider: null, destination: null, shop: null });
    expect(await call()).toEqual({ state: "hidden", ageSeconds: null, rider: null, destination: null, shop: null });
  });
});

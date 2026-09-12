import { describe, expect, it } from "vitest";
import { type KitchenSource, isLate, nextKitchenStatus, toKitchenTickets, waitingMinutes } from "./tickets";

const at = (iso: string) => new Date(iso);

function source(overrides: Partial<KitchenSource> = {}): KitchenSource {
  return {
    id: "o1",
    orderNumber: "007",
    status: "ACCEPTED",
    fulfilment: "TAKEAWAY",
    tableName: null,
    customerName: "Aman",
    notes: null,
    items: [{ name: "Nashville Burger", quantity: 2, modifiers: ["Extra hot"] }],
    placedAt: at("2026-09-12T10:00:00Z"),
    estimatedReadyAt: at("2026-09-12T10:20:00Z"),
    ...overrides,
  };
}

describe("kitchen tickets", () => {
  it("shows only what the kitchen is working on", () => {
    const rows = [
      source({ id: "new", status: "PENDING_PAYMENT" }),
      source({ id: "paid", status: "PAID" }),
      source({ id: "a", status: "ACCEPTED" }),
      source({ id: "p", status: "PREPARING" }),
      source({ id: "r", status: "READY" }),
      source({ id: "out", status: "OUT_FOR_DELIVERY" }),
      source({ id: "done", status: "COMPLETED" }),
    ];
    expect(toKitchenTickets(rows).map((ticket) => ticket.id)).toEqual(["a", "p", "r"]);
  });

  it("puts the longest-waiting ticket first", () => {
    const rows = [
      source({ id: "later", placedAt: at("2026-09-12T10:05:00Z") }),
      source({ id: "earlier", placedAt: at("2026-09-12T10:01:00Z") }),
    ];
    expect(toKitchenTickets(rows).map((ticket) => ticket.id)).toEqual(["earlier", "later"]);
  });

  it("carries no money and no phone number", () => {
    const [ticket] = toKitchenTickets([source()]);
    expect(ticket).not.toHaveProperty("grandTotal");
    expect(ticket).not.toHaveProperty("customerPhone");
  });

  it("counts whole minutes waiting, never negative", () => {
    const ticket = { placedAt: "2026-09-12T10:00:00Z" };
    expect(waitingMinutes(ticket, Date.parse("2026-09-12T10:07:59Z"))).toBe(7);
    expect(waitingMinutes(ticket, Date.parse("2026-09-12T09:59:00Z"))).toBe(0);
    expect(waitingMinutes({ placedAt: null }, Date.now())).toBe(0);
  });

  it("is late only once the promised time has passed, and never without one", () => {
    const promised = { promisedAt: "2026-09-12T10:20:00Z" };
    expect(isLate(promised, Date.parse("2026-09-12T10:19:59Z"))).toBe(false);
    expect(isLate(promised, Date.parse("2026-09-12T10:20:01Z"))).toBe(true);
    expect(isLate({ promisedAt: null }, Date.parse("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("moves a ticket forward one column and stops at ready — handover is the counter's", () => {
    expect(nextKitchenStatus("ACCEPTED")).toEqual({ to: "PREPARING", label: "Start cooking" });
    expect(nextKitchenStatus("PREPARING")).toEqual({ to: "READY", label: "Ready" });
    expect(nextKitchenStatus("READY")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { type KitchenSource, type KitchenTicket, NEARLY_LATE_RATIO, healthCounts, isLate, prepHealth, ticketPrepTarget, nextKitchenStatus, toKitchenTickets, waitingMinutes } from "./tickets";

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

  it("attaches the prep target for the order, and null when none is known", () => {
    const tickets = toKitchenTickets([source({ id: "a" }), source({ id: "b" })], new Map([["a", 12]]));
    expect(tickets.find((t) => t.id === "a")?.prepTargetMinutes).toBe(12);
    expect(tickets.find((t) => t.id === "b")?.prepTargetMinutes).toBeNull();
    expect(toKitchenTickets([source()])[0]?.prepTargetMinutes).toBeNull();
  });
});

describe("ticketPrepTarget", () => {
  it("is the max over lines", () => {
    expect(ticketPrepTarget([6, 12, 9])).toBe(12);
  });
  it("ignores lines with no target, and is null when none has one", () => {
    expect(ticketPrepTarget([null, 8, undefined])).toBe(8);
    expect(ticketPrepTarget([null, undefined])).toBeNull();
    expect(ticketPrepTarget([])).toBeNull();
  });
  it("ignores zero, negative and non-finite values", () => {
    expect(ticketPrepTarget([0, -3, Number.NaN])).toBeNull();
  });
});

describe("prepHealth", () => {
  const placedAt = "2026-09-12T10:00:00Z";
  const ticket = (over: Partial<Pick<KitchenTicket, "status" | "placedAt" | "promisedAt" | "prepTargetMinutes">> = {}) => ({
    status: "PREPARING" as const,
    placedAt,
    promisedAt: null,
    prepTargetMinutes: 10,
    ...over,
  });
  const at10 = (minutes: number, seconds = 0) => Date.parse(placedAt) + (minutes * 60 + seconds) * 1000;

  it("nearly-late ratio is 80%", () => expect(NEARLY_LATE_RATIO).toBe(0.8));

  it("is green before 80% of the target", () => {
    expect(prepHealth(ticket(), at10(7, 59))).toBe("GREEN");
  });
  it("turns amber exactly at 80%", () => {
    expect(prepHealth(ticket(), at10(8))).toBe("AMBER");
    expect(prepHealth(ticket(), at10(9, 59))).toBe("AMBER");
  });
  it("turns red exactly at 100%", () => {
    expect(prepHealth(ticket(), at10(10))).toBe("RED");
    expect(prepHealth(ticket(), at10(30))).toBe("RED");
  });
  it("is red past the promised time even with no target", () => {
    expect(prepHealth(ticket({ prepTargetMinutes: null, promisedAt: "2026-09-12T10:20:00Z" }), at10(21))).toBe("RED");
  });
  it("is green with no target and no promise, however long it waits", () => {
    expect(prepHealth(ticket({ prepTargetMinutes: null }), at10(600))).toBe("GREEN");
  });
  it("is green with no placed time", () => {
    expect(prepHealth(ticket({ placedAt: null }), at10(600))).toBe("GREEN");
  });
  it("is always green once READY", () => {
    expect(prepHealth(ticket({ status: "READY" }), at10(600))).toBe("GREEN");
  });
  it("an ACCEPTED ticket is judged the same as a PREPARING one", () => {
    expect(prepHealth(ticket({ status: "ACCEPTED" }), at10(9))).toBe("AMBER");
  });
});

describe("healthCounts (roadmap 4.3)", () => {
  const placedAt = "2026-09-12T10:00:00Z";
  const ticket = (over: Partial<Pick<KitchenTicket, "status" | "placedAt" | "promisedAt" | "prepTargetMinutes">> = {}) => ({
    status: "PREPARING" as const,
    placedAt,
    promisedAt: null,
    prepTargetMinutes: 10,
    ...over,
  });
  const at10 = (minutes: number) => Date.parse(placedAt) + minutes * 60_000;

  it("is all zero for no tickets", () => {
    expect(healthCounts([], Date.now())).toEqual({ green: 0, amber: 0, red: 0 });
  });

  it("counts each ticket into exactly one bucket", () => {
    const tickets = [ticket(), ticket({ prepTargetMinutes: 5 }), ticket({ prepTargetMinutes: 3 }), ticket({ status: "READY" })];
    // at 6 minutes elapsed: the 10-min target is green (60%), the 5-min target is red (120%), the 3-min is red too, READY is always green
    expect(healthCounts(tickets, at10(6))).toEqual({ green: 2, amber: 0, red: 2 });
  });

  it("matches prepHealth ticket-by-ticket, including the amber band", () => {
    const tickets = [ticket({ prepTargetMinutes: 10 }), ticket({ prepTargetMinutes: 5 })];
    // at 8 minutes: 10-min target is at 80% (amber), 5-min target is well past 100% (red)
    expect(healthCounts(tickets, at10(8))).toEqual({ green: 0, amber: 1, red: 1 });
  });

  it("a ticket with no target and no promise never counts as amber or red, however long it waits", () => {
    expect(healthCounts([ticket({ prepTargetMinutes: null })], at10(600))).toEqual({ green: 1, amber: 0, red: 0 });
  });
});

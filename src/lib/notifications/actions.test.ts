import { beforeEach, describe, expect, it, vi } from "vitest";

const PHONE = "9876543210";
const OTHER_PHONE = "9123456780";
const ORDER = {
  id: "order-1",
  orgId: "org-1",
  orderNumber: 7,
  invoiceNumber: "INV-7",
  customerName: "Asha",
  customerPhone: PHONE,
  grandTotal: 49900n,
  fulfilment: "TAKEAWAY",
  status: "PAID",
};

const state = {
  order: ORDER as typeof ORDER | null,
  customer: null as { phone: string | null; email: string | null } | null,
  remembered: null as { phone: string } | null,
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/repositories/org", () => ({ getOrg: async () => ({ id: "org-1" }) }));
vi.mock("@/lib/customer", () => ({ getCustomer: async () => state.customer }));
vi.mock("@/lib/cart/remembered-contact", () => ({ readRememberedContact: async () => state.remembered }));
vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: (table: { __items?: boolean }) => ({
        where: () => {
          const rows = table.__items ? [] : state.order ? [state.order] : [];
          return Object.assign(Promise.resolve(rows), { limit: async () => rows });
        },
      }),
    }),
  }),
}));
vi.mock("@/db/schema", () => ({ orders: {}, orderItems: { __items: true } }));

import { whatsappOrderLink } from "./actions";

beforeEach(() => {
  state.order = ORDER;
  state.customer = null;
  state.remembered = null;
  process.env.SITE_URL = "https://frybirdiq.tech";
});

function expectDenied(result: Awaited<ReturnType<typeof whatsappOrderLink>>) {
  expect(result.ok).toBe(false);
  const body = JSON.stringify(result);
  expect(body).not.toContain(PHONE);
  expect(body).not.toContain(`91${PHONE}`);
  expect(body).not.toContain("wa.me");
}

describe("whatsappOrderLink authorization", () => {
  it("denies an anonymous visitor, with no phone in the response", async () => {
    expectDenied(await whatsappOrderLink({ orderId: "order-1" }));
  });

  it("returns the link to the owner (remembered-contact cookie)", async () => {
    state.remembered = { phone: PHONE };
    const result = await whatsappOrderLink({ orderId: "order-1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain(`https://wa.me/91${PHONE}`);
  });

  it("returns the link to the signed-in owner", async () => {
    state.customer = { phone: PHONE, email: null };
    const result = await whatsappOrderLink({ orderId: "order-1" });
    expect(result.ok).toBe(true);
  });

  it("denies a different customer's session and a valid session on someone else's order", async () => {
    state.customer = { phone: OTHER_PHONE, email: "other@example.com" };
    expectDenied(await whatsappOrderLink({ orderId: "order-1" }));

    state.customer = null;
    state.remembered = { phone: OTHER_PHONE };
    expectDenied(await whatsappOrderLink({ orderId: "order-1" }));
  });

  it("answers a missing order exactly as it answers someone else's order", async () => {
    state.order = null;
    state.remembered = { phone: PHONE };
    const missing = await whatsappOrderLink({ orderId: "nope" });
    state.order = ORDER;
    state.remembered = { phone: OTHER_PHONE };
    const foreign = await whatsappOrderLink({ orderId: "order-1" });
    expect(missing).toEqual(foreign);
  });
});

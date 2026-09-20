/**
 * submitCheckout — the customer's "Place order" (pay-ready).
 *
 * The action is an adapter: it forwards the form to placeOrder and decides
 * what the browser sees next. What must hold: nothing that sets money leaves
 * the form (the server prices the cart), the cart is cleared only after an
 * order exists, a failure costs the customer nothing, and an unpaid online
 * order already in flight is resumed rather than duplicated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const placeOrder = vi.fn();
const writeCart = vi.fn<(cart: unknown) => Promise<void>>(async () => undefined);
const rememberContact = vi.fn<(contact: unknown) => Promise<void>>(async () => undefined);
const rememberAddress = vi.fn<(address: unknown) => Promise<void>>(async () => undefined);
const revalidatePath = vi.fn();
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
const redirect = vi.fn((to: string) => {
  throw new Redirect(to);
});

vi.mock("@/lib/repositories/orders", () => ({ placeOrder: (input: unknown) => placeOrder(input) }));
vi.mock("./index", () => ({ writeCart: (cart: unknown) => writeCart(cart) }));
vi.mock("./remembered-contact", () => ({ rememberContact: (c: unknown) => rememberContact(c) }));
vi.mock("./remembered-address", () => ({ rememberAddress: (a: unknown) => rememberAddress(a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { submitCheckout } = await import("./checkout-action");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const FIELDS = { name: "Asha", phone: "9876543210", fulfilment: "TAKEAWAY", idempotencyKey: "0f0e0d0c-0b0a-4090-8070-605040302010", when: "ASAP", payment: "ONLINE" };

async function submit(fields: Record<string, string>) {
  try {
    return { state: await submitCheckout({ status: "idle" }, form(fields)), redirectedTo: null };
  } catch (error) {
    if (error instanceof Redirect) return { state: null, redirectedTo: error.to };
    throw error;
  }
}

describe("submitCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never forwards a price, total or amount the browser sent — the server prices the cart", async () => {
    placeOrder.mockResolvedValue({ ok: true, orderId: "o-1", payment: "ONLINE" });
    await submit({ ...FIELDS, total: "1", grandTotal: "1", amount: "1", price: "1", discount: "99999" });
    const input = placeOrder.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(input).filter((key) => /total|amount|price|discount|paise/i.test(key))).toEqual([]);
    expect(input).toMatchObject({ name: "Asha", phone: "9876543210", payment: "ONLINE", idempotencyKey: FIELDS.idempotencyKey });
  });

  it("an online order lands on its page with the payment window open, and the cart is cleared only after it exists", async () => {
    placeOrder.mockResolvedValue({ ok: true, orderId: "o-1", payment: "ONLINE" });
    const { redirectedTo } = await submit(FIELDS);
    expect(redirectedTo).toBe("/order/o-1?pay=1");
    expect(writeCart).toHaveBeenCalledWith({ lines: [] });
    expect(placeOrder.mock.invocationCallOrder[0]!).toBeLessThan(writeCart.mock.invocationCallOrder[0]!);
    expect(rememberContact).toHaveBeenCalledTimes(1);
  });

  it("a pay-on-collection order lands on its page without the payment window", async () => {
    placeOrder.mockResolvedValue({ ok: true, orderId: "o-2", payment: "COD" });
    expect((await submit({ ...FIELDS, payment: "COD" })).redirectedTo).toBe("/order/o-2");
  });

  it("a refusal costs nothing: the cart is kept, nothing is remembered, and the server's own words and closed-shop state are shown", async () => {
    const closed = { code: "CLOSED" };
    placeOrder.mockResolvedValue({ ok: false, error: "The kitchen is closed right now.", fieldErrors: { when: "Closed" }, closed });
    const { state, redirectedTo } = await submit(FIELDS);
    expect(redirectedTo).toBeNull();
    expect(state).toEqual({ status: "error", message: "The kitchen is closed right now.", fieldErrors: { when: "Closed" }, closed });
    expect(writeCart).not.toHaveBeenCalled();
    expect(rememberContact).not.toHaveBeenCalled();
  });

  it("an unpaid online order already in flight for this phone is resumed, not duplicated, and the cart is kept", async () => {
    placeOrder.mockResolvedValue({ ok: false, error: "You already have an unpaid order.", resumeOrderId: "o-open" });
    expect((await submit(FIELDS)).redirectedTo).toBe("/order/o-open?pay=1");
    expect(writeCart).not.toHaveBeenCalled();
  });
});

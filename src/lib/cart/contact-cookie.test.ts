import { describe, expect, it } from "vitest";
import { MAX_REMEMBERED_ORDERS, decodeContactCookie, encodeContactCookie, withOrder } from "./contact-cookie";

const contact = { name: "Asha Verma", phone: "9000000001", email: "asha@example.test" };
const secret = "s".repeat(40);
const other = "t".repeat(40);

describe("the remembered-contact cookie (cookie-sign-1)", () => {
  it("with no secret it is the plain JSON it always was: nothing changes until a secret is set", () => {
    expect(encodeContactCookie(contact)).toBe(JSON.stringify(contact));
    expect(decodeContactCookie(JSON.stringify(contact))).toEqual(contact);
  });

  it("with a secret it round-trips as a signed cookie", () => {
    const raw = encodeContactCookie(contact, secret);
    expect(raw.startsWith("v1.")).toBe(true);
    expect(decodeContactCookie(raw, secret)).toEqual(contact);
  });

  it("a forged cookie is refused: plain JSON with a secret set (someone typed a victim's phone into their own cookie)", () => {
    expect(decodeContactCookie(JSON.stringify({ ...contact, phone: "9111111111" }), secret)).toBeNull();
  });

  it("a signed cookie with a changed body, a changed signature, another secret, or missing parts is refused", () => {
    const [v, body, mac] = encodeContactCookie(contact, secret).split(".") as [string, string, string];
    const forgedBody = Buffer.from(JSON.stringify({ ...contact, phone: "9111111111" })).toString("base64url");
    expect(decodeContactCookie(`${v}.${forgedBody}.${mac}`, secret)).toBeNull();
    expect(decodeContactCookie(`${v}.${body}.${mac.slice(0, -2)}AA`, secret)).toBeNull();
    expect(decodeContactCookie(`${v}.${body}.${mac}`, other)).toBeNull();
    expect(decodeContactCookie(`${v}.${body}`, secret)).toBeNull();
    expect(decodeContactCookie(`${v}.${body}.${mac}.extra`, secret)).toBeNull();
    expect(decodeContactCookie("v2." + body + "." + mac, secret)).toBeNull();
    expect(decodeContactCookie("", secret)).toBeNull();
  });

  it("a signed cookie with no secret configured fails closed (it cannot be verified)", () => {
    expect(decodeContactCookie(encodeContactCookie(contact, secret))).toBeNull();
  });

  it("garbage never throws", () => {
    for (const raw of ["not json", "{", "v1.", "v1..", "v1.%%%.%%%", "null", "[]"]) {
      expect(() => decodeContactCookie(raw, secret)).not.toThrow();
      expect(decodeContactCookie(raw, secret)).toBeNull();
    }
    expect(decodeContactCookie("not json")).toBeNull();
  });

  it("the signature covers the whole body: flipping any single character of the body invalidates it", () => {
    const [v, body, mac] = encodeContactCookie(contact, secret).split(".") as [string, string, string];
    for (let i = 0; i < body.length; i += 7) {
      const flipped = body.slice(0, i) + (body[i] === "A" ? "B" : "A") + body.slice(i + 1);
      expect(decodeContactCookie(`${v}.${flipped}.${mac}`, secret), `char ${i}`).toBeNull();
    }
  });
});

describe("withOrder: the orders this browser placed", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("adds the new order first and keeps the older ones behind it", () => {
    expect(withOrder([id(1)], id(2))).toEqual([id(2), id(1)]);
    expect(withOrder(undefined, id(1))).toEqual([id(1)]);
  });

  it("never lists an order twice", () => {
    expect(withOrder([id(2), id(1)], id(1))).toEqual([id(1), id(2)]);
  });

  it("keeps at most the newest MAX_REMEMBERED_ORDERS, so the cookie stays small", () => {
    let orders: readonly string[] = [];
    for (let n = 1; n <= MAX_REMEMBERED_ORDERS + 5; n++) orders = withOrder(orders, id(n));
    expect(orders).toHaveLength(MAX_REMEMBERED_ORDERS);
    expect(orders[0]).toBe(id(MAX_REMEMBERED_ORDERS + 5));
    expect(orders).not.toContain(id(1));
    // and a signed cookie carrying that many is still comfortably below the ~4 KB cookie limit
    expect(encodeContactCookie({ name: "Asha Verma", phone: "9000000001", email: "asha@example.test", orders }, "s".repeat(40)).length).toBeLessThan(2500);
  });
});

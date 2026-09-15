import { describe, expect, it } from "vitest";

import { WHATSAPP_LINK_PROVIDER, whatsappLink, whatsappLinkProvider } from "./whatsapp-link";

describe("whatsappLink", () => {
  it("builds a wa.me link with the country code and the message pre-filled", () => {
    const url = whatsappLink("9876543210", "Your order is ready!");
    expect(url).toBe("https://wa.me/919876543210?text=Your%20order%20is%20ready!");
  });

  it("strips formatting punctuation before validating the number", () => {
    expect(whatsappLink("+91 98765-43210", "hi")).toBe("https://wa.me/919876543210?text=hi");
  });

  it("accepts a number that already carries the country code", () => {
    expect(whatsappLink("919876543210", "hi")).toBe("https://wa.me/919876543210?text=hi");
  });

  it("refuses a number that cannot be a mobile number — the country code cannot be guessed for it", () => {
    expect(whatsappLink("12345", "hi")).toBeNull(); // too short
    expect(whatsappLink("0123456789", "hi")).toBeNull(); // landline-shaped, does not start 6–9
    expect(whatsappLink("98765432100", "hi")).toBeNull(); // one digit too many
  });

  it("percent-encodes characters that would otherwise break the URL", () => {
    const url = whatsappLink("9876543210", "Order #42 — ₹499, ready & waiting");
    expect(url).toContain(encodeURIComponent("Order #42 — ₹499, ready & waiting"));
  });
});

describe("whatsappLinkProvider", () => {
  it("is named for the registry", () => {
    expect(whatsappLinkProvider.name).toBe(WHATSAPP_LINK_PROVIDER);
  });

  it("returns a manual send with the link for a reachable number", async () => {
    const result = await whatsappLinkProvider.sendWhatsapp({ to: "9876543210", message: "Ready for pickup" });
    expect(result).toEqual({
      ok: true,
      manual: true,
      url: "https://wa.me/919876543210?text=Ready%20for%20pickup",
    });
  });

  it("fails honestly, still as manual, for a number WhatsApp cannot reach", async () => {
    const result = await whatsappLinkProvider.sendWhatsapp({ to: "12345", message: "hi" });
    expect(result.ok).toBe(false);
    expect(result.manual).toBe(true);
  });

  it("never claims to have sent an SMS — there is no DLT-registered sender behind it", async () => {
    const result = await whatsappLinkProvider.sendSms({ to: "9876543210", message: "hi" });
    expect(result.ok).toBe(false);
    expect(result.manual).toBe(false);
  });

  it("never claims to have sent an email — there is no provider wired up", async () => {
    const result = await whatsappLinkProvider.sendEmail({ to: "a@example.com", subject: "Order ready", body: "hi" });
    expect(result.ok).toBe(false);
    expect(result.manual).toBe(false);
  });
});

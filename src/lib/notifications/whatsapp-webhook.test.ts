import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eventTypesOf, verifyHandshake, verifySignature, whatsappAppSecret, whatsappVerifyToken } from "./whatsapp-webhook";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("whatsappVerifyToken / whatsappAppSecret", () => {
  it("reads the raw env var, trimmed, and null when unset or blank", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "  a-token  ";
    process.env.WHATSAPP_APP_SECRET = "";
    expect(whatsappVerifyToken()).toBe("a-token");
    expect(whatsappAppSecret()).toBeNull();
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    expect(whatsappVerifyToken()).toBeNull();
  });
});

describe("verifyHandshake", () => {
  const configuredToken = "the-real-token";

  it("accepts mode=subscribe with the exact matching token", () => {
    expect(verifyHandshake({ mode: "subscribe", token: configuredToken, configuredToken })).toBe(true);
  });

  it("fails closed when no token is configured, regardless of what is presented", () => {
    expect(verifyHandshake({ mode: "subscribe", token: "anything", configuredToken: null })).toBe(false);
    expect(verifyHandshake({ mode: "subscribe", token: null, configuredToken: null })).toBe(false);
  });

  it("refuses a wrong mode", () => {
    expect(verifyHandshake({ mode: "unsubscribe", token: configuredToken, configuredToken })).toBe(false);
    expect(verifyHandshake({ mode: null, token: configuredToken, configuredToken })).toBe(false);
  });

  it("refuses a missing or wrong token", () => {
    expect(verifyHandshake({ mode: "subscribe", token: null, configuredToken })).toBe(false);
    expect(verifyHandshake({ mode: "subscribe", token: "wrong-token", configuredToken })).toBe(false);
    // A token that is a prefix or has different length must not accidentally pass.
    expect(verifyHandshake({ mode: "subscribe", token: configuredToken.slice(0, -1), configuredToken })).toBe(false);
  });
});

function signatureFor(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifySignature", () => {
  const appSecret = "app-secret-value";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("accepts a correctly signed body", () => {
    expect(verifySignature({ body, header: signatureFor(body, appSecret), appSecret })).toBe(true);
  });

  it("fails closed when no app secret is configured", () => {
    expect(verifySignature({ body, header: signatureFor(body, appSecret), appSecret: null })).toBe(false);
  });

  it("refuses a missing signature header", () => {
    expect(verifySignature({ body, header: null, appSecret })).toBe(false);
  });

  it("refuses a header with no sha256= prefix", () => {
    const raw = createHmac("sha256", appSecret).update(body).digest("hex");
    expect(verifySignature({ body, header: raw, appSecret })).toBe(false);
  });

  it("refuses a signature computed with the wrong secret", () => {
    expect(verifySignature({ body, header: signatureFor(body, "wrong-secret"), appSecret })).toBe(false);
  });

  it("refuses a signature for a different body (the exact raw body matters)", () => {
    const otherBody = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [] }] });
    expect(verifySignature({ body: otherBody, header: signatureFor(body, appSecret), appSecret })).toBe(false);
  });

  it("is case-insensitive on the hex digest", () => {
    const header = signatureFor(body, appSecret).toUpperCase().replace("SHA256=", "sha256=");
    expect(verifySignature({ body, header, appSecret })).toBe(true);
  });
});

describe("eventTypesOf", () => {
  it("extracts object and each change's field, nothing else", () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        { changes: [{ field: "messages", value: { messages: [{ from: "919000000001", text: { body: "secret text" } }] } }] },
        { changes: [{ field: "message_template_status_update" }] },
      ],
    });
    const summary = eventTypesOf(body);
    expect(summary.object).toBe("whatsapp_business_account");
    expect(summary.fields).toEqual(["messages", "message_template_status_update"]);
    expect(JSON.stringify(summary)).not.toContain("919000000001");
    expect(JSON.stringify(summary)).not.toContain("secret text");
  });

  it("never throws on malformed JSON, and returns an empty summary", () => {
    expect(eventTypesOf("not json")).toEqual({ object: null, fields: [] });
    expect(eventTypesOf("")).toEqual({ object: null, fields: [] });
  });

  it("never throws on unexpected (but valid) JSON shapes", () => {
    expect(eventTypesOf(JSON.stringify({ unexpected: true }))).toEqual({ object: null, fields: [] });
    expect(eventTypesOf(JSON.stringify([1, 2, 3]))).toEqual({ object: null, fields: [] });
    expect(eventTypesOf(JSON.stringify(null))).toEqual({ object: null, fields: [] });
  });

  it("tolerates an entry with no changes, or a change with no field", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{}, { changes: [{}] }] });
    expect(eventTypesOf(body)).toEqual({ object: "whatsapp_business_account", fields: [] });
  });

  it("the returned summary has only object and fields — no path to a phone number or message text", () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "919000000001" }] } }] }],
    });
    expect(Object.keys(eventTypesOf(body))).toEqual(["object", "fields"]);
  });
});

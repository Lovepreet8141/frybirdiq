import { afterEach, describe, expect, it } from "vitest";
import { absoluteUrl, PRIVATE_PATHS, siteUrl } from "./site";

const original = process.env.SITE_URL;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = original;
});

describe("site url", () => {
  it("defaults to the production domain, never localhost", () => {
    delete process.env.SITE_URL;
    expect(siteUrl()).toBe("https://frybirdiq.tech");
    process.env.SITE_URL = "";
    expect(siteUrl()).toBe("https://frybirdiq.tech");
  });

  it("reads SITE_URL at call time and drops a trailing slash", () => {
    process.env.SITE_URL = "https://example.test/";
    expect(absoluteUrl("/menu")).toBe("https://example.test/menu");
    expect(absoluteUrl("item/x")).toBe("https://example.test/item/x");
  });

  it("ignores a SITE_URL that would publish a local address (build-time hazard)", () => {
    for (const bad of ["http://localhost:3000", "http://127.0.0.1:3000", "https://localhost", "http://frybirdiq.tech", "not a url", "https://192.168.1.5"]) {
      process.env.SITE_URL = bad;
      expect(siteUrl()).toBe("https://frybirdiq.tech");
    }
  });

  it("keeps staff, account, order and checkout out of the index", () => {
    expect(PRIVATE_PATHS).toEqual(["/app/", "/account/", "/order/", "/checkout"]);
  });
});

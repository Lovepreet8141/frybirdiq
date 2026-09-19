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
    for (const bad of ["http://localhost:3000", "http://127.0.0.1:3000", "https://localhost", "http://frybirdiq.tech", "not a url", "https://192.168.1.5", "https://172.16.0.1", "https://172.20.5.5", "https://172.31.255.255", "https://169.254.1.1"]) {
      process.env.SITE_URL = bad;
      expect(siteUrl()).toBe("https://frybirdiq.tech");
    }
  });

  it("does not mistake public 172.x addresses outside 16-31 for private ones", () => {
    process.env.SITE_URL = "https://172.32.0.1";
    expect(siteUrl()).toBe("https://172.32.0.1");
  });

  it("keeps staff, account, order and checkout out of the index", () => {
    expect(PRIVATE_PATHS).toEqual(["/app/", "/account/", "/order/", "/checkout"]);
  });
});

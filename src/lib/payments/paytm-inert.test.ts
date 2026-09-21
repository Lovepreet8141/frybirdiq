/**
 * The Paytm provider ships as mock-only code (owner decision, 2026-09-21):
 * present in the tree, unreachable in production, invisible to checkout. These
 * tests pin that, so a later change that wires it in has to break one of them
 * on purpose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { availableMethods, getProvider } from "./index";
import { PAYTM_SANDBOX_VERIFIED, isPaytmConfigured, paytmGate } from "./paytm";

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("Paytm is inert until it is proven and switched on", () => {
  it("is marked not verified against Paytm's sandbox, in code", () => {
    expect(PAYTM_SANDBOX_VERIFIED).toBe(false);
    const header = readFileSync(path.join(__dirname, "paytm.ts"), "utf8").slice(0, 1500);
    expect(header).toMatch(/NOT VERIFIED AGAINST PAYTM SANDBOX/);
    const doc = readFileSync(path.resolve(SRC, "../docs/PAYTM-PROVIDER.md"), "utf8").slice(0, 600);
    expect(doc).toMatch(/NOT VERIFIED AGAINST PAYTM SANDBOX/);
  });

  it("with no Paytm keys set it is not configured and cannot be selected", () => {
    expect(isPaytmConfigured()).toBe(false);
    expect(() => getProvider("paytm")).toThrow();
  });

  it("production credentials are refused while the sandbox proof is missing, and staging is refused on the live site", () => {
    for (const allowStaging of [false, true]) {
      expect(paytmGate({ env: "production", sandboxVerified: PAYTM_SANDBOX_VERIFIED, productionDeployment: true, allowStaging }).allowed).toBe(false);
      expect(paytmGate({ env: "production", sandboxVerified: PAYTM_SANDBOX_VERIFIED, productionDeployment: false, allowStaging }).allowed).toBe(false);
    }
    expect(paytmGate({ env: "staging", sandboxVerified: PAYTM_SANDBOX_VERIFIED, productionDeployment: true, allowStaging: false }).allowed).toBe(false);
  });

  it("the payment methods a customer is offered are exactly what they were: cash, and online only through Razorpay", () => {
    const cash = { method: "CASH", provider: "cash", choice: "COD", label: "Pay on collection", detail: "Cash, UPI or card at the counter, or at the door." };
    expect(availableMethods()).toEqual([cash]); // no Razorpay keys in the test environment
    expect(availableMethods({ cash: true, online: true })).toEqual([cash]);
    expect(availableMethods({ cash: true, online: false })).toEqual([cash]);
    expect(availableMethods({ cash: false, online: true })).toEqual([]);
    expect(availableMethods({ cash: false, online: false })).toEqual([]);
    expect(JSON.stringify(availableMethods())).not.toMatch(/paytm/i);
  });

  it("nothing outside the payments module, the env schema and the docs can reach it: no checkout, route, action or page mentions Paytm", () => {
    const allowed = new Set(["lib/payments/paytm.ts", "lib/payments/paytm.test.ts", "lib/payments/paytm-inert.test.ts", "lib/payments/__fixtures__/paytm.ts", "lib/payments/index.ts", "lib/payments/provider.ts", "lib/env/index.ts"]);
    const mentions = sourceFiles(SRC)
      .filter((file) => /paytm/i.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
      .filter((rel) => !allowed.has(rel));
    expect(mentions).toEqual([]);
  });
});

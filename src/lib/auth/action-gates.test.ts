/**
 * The permission-gate extractor's own tests: every way of keeping the gate
 * test green WITHOUT an effective gate must be refused. Each case here is a
 * bypass the security review found (pay-ready).
 */
import { describe, expect, it } from "vitest";
import { gatesOfSource } from "./__test-support__/action-gates";

const gates = (body: string, header = '"use server";\nimport { requirePermission, staffCan, can, authorize } from "x";\n') => gatesOfSource(`${header}${body}`, "f.ts");

describe("a real gate is seen", () => {
  it("requirePermission at the top, inside a try, or through a local helper", () => {
    expect(gates('export async function a() { const s = await requirePermission("orders.update"); return s; }')).toEqual({ "f.ts#a": { gates: ["orders.update"] } });
    expect(gates('export async function a() { try { await requirePermission("orders.update"); } catch { return 1; } return 2; }')["f.ts#a"]?.gates).toEqual(["orders.update"]);
    expect(gates('async function guard(p: string) { await requirePermission(p); }\nexport async function a() { await guard("menu.edit"); }')["f.ts#a"]?.gates).toEqual(["menu.edit"]);
  });

  it("a decision call whose result is USED: `if (!(await staffCan(...))) return`", () => {
    expect(gates('export async function a() { if (!(await staffCan("finance.view"))) return null; return 1; }')["f.ts#a"]?.gates).toEqual(["finance.view"]);
    expect(gates('export async function a(roles: string[]) { const ok = can(roles, "orders.create"); if (!ok) throw new Error("no"); }')["f.ts#a"]?.gates).toEqual(["orders.create"]);
  });
});

describe("a gate that does not run on every call is NOT a gate", () => {
  it.each([
    ["inside an if body", 'export async function a(x: boolean) { if (x) { await requirePermission("orders.update"); } }'],
    ["inside `if (false)`", 'export async function a() { if (false) { await requirePermission("orders.update"); } }'],
    ["on the right of &&", 'export async function a(x: boolean) { x && (await requirePermission("orders.update")); }'],
    ["in one arm of ?:", 'export async function a(x: boolean) { return x ? await requirePermission("orders.update") : null; }'],
    ["only in a catch", 'export async function a() { try { await Promise.resolve(); } catch { await requirePermission("orders.update"); } }'],
    ["inside a loop body", 'export async function a() { for (const i of [1]) { await requirePermission("orders.update"); } }'],
    ["in a switch case", 'export async function a(k: string) { switch (k) { case "x": await requirePermission("orders.update"); } }'],
    ["in a nested function that is never called", 'export async function a() { const f = async () => { await requirePermission("orders.update"); }; return f; }'],
  ])("%s", (_label, body) => {
    expect(gates(body)["f.ts#a"]?.gates).toEqual([]);
  });
});

describe("a decision that is thrown away is NOT a gate", () => {
  it("a bare can(...), staffCan(...) or authorize(...) statement, awaited or not, or under void", () => {
    expect(gates('export async function a(roles: string[]) { can(roles, "orders.update"); }')["f.ts#a"]?.gates).toEqual([]);
    expect(gates('export async function a() { await staffCan("orders.update"); }')["f.ts#a"]?.gates).toEqual([]);
    expect(gates('export async function a() { void staffCan("orders.update"); }')["f.ts#a"]?.gates).toEqual([]);
    expect(gates('export async function a(roles: string[]) { authorize(roles, "orders.update"); }')["f.ts#a"]?.gates).toEqual([]);
  });
});

describe("only a plain call by name counts", () => {
  it("obj.can(...) and obj.requirePermission(...) are not the real gates", () => {
    expect(gates('export async function a(obj: any) { if (!obj.can("orders.update")) return; await obj.requirePermission("orders.update"); }')["f.ts#a"]?.gates).toEqual([]);
  });
});

describe("a file cannot hide from the test", () => {
  it("a comment above the directive still makes it a server file", () => {
    const found = gatesOfSource('/** docs */\n"use server";\nexport async function a() { return 1; }', "f.ts");
    expect(Object.keys(found)).toEqual(["f.ts#a"]);
    expect(found["f.ts#a"]?.gates).toEqual([]);
  });

  it("a file without the directive is not a server file", () => {
    expect(gatesOfSource("export async function a() { return 1; }", "f.ts")).toEqual({});
  });

  it.each([
    ["export default", "export default async function () { return 1; }"],
    ["export { name }", "async function a() { return 1; }\nexport { a };"],
    ["a wrapped export", "export const a = wrap(async () => 1);"],
  ])("%s is an error, never silently skipped", (_label, body) => {
    expect(() => gates(body)).toThrow(/permission-gate test/);
  });

  it("type-only exports are fine", () => {
    expect(() => gates("export type T = string;\nexport interface I { a: 1 }\nexport async function a() { return 1; }")).not.toThrow();
  });
});

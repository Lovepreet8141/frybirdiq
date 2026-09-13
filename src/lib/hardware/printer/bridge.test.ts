import { describe, expect, it, vi } from "vitest";
import { getPrinterClient } from "@/lib/printer/client";
import { BridgeTransport, type NativeChannel, createNativePrinterProvider, ensureBridge } from "./bridge";
import { BRIDGE_OPS } from "./types";

/** A native side that answers the protocol the way the Android bridge does. */
function fakeNative(handlers: Partial<Record<string, (payload: Record<string, unknown>) => unknown | Promise<unknown>>>) {
  const seen: { op: string; payload: Record<string, unknown> }[] = [];
  const channel: NativeChannel = {
    onmessage: null,
    postMessage(message: string) {
      const request = JSON.parse(message) as { v: number; id: string; op: string; payload: Record<string, unknown> };
      seen.push({ op: request.op, payload: request.payload });
      const reply = (body: Record<string, unknown>) => queueMicrotask(() => channel.onmessage?.({ data: JSON.stringify({ v: 1, id: request.id, ...body }) }));
      if (!BRIDGE_OPS.includes(request.op as (typeof BRIDGE_OPS)[number])) return reply({ ok: false, error: { code: "INVALID_REQUEST", message: "Unknown op" } });
      const handler = handlers[request.op];
      if (!handler) return reply({ ok: false, error: { code: "BRIDGE_ERROR", message: `No handler for ${request.op}` } });
      new Promise((resolve) => resolve(handler(request.payload))).then(
        (result) => reply({ ok: true, result }),
        (error: Error) => reply({ ok: false, error: { code: "PRINTER_UNREACHABLE", message: error.message } }),
      );
    },
  };
  return { channel, seen };
}

describe("bridge shim", () => {
  it("matches replies to requests and returns typed capabilities", async () => {
    const { channel } = fakeNative({
      CAPABILITIES: () => ({ deviceId: "abc", deviceName: "Redmi Pad", platform: "ANDROID", deviceType: "TABLET", model: "Redmi Pad", manufacturer: "Xiaomi", appVersion: "1.0.0", bridgeVersion: "1", capabilities: { printer: true, localPrinterBridge: true, wifi: true, bluetooth: true, usb: false }, network: { wifiConnected: true, subnet: "192.168.1" } }),
    });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const capabilities = await provider.getCapabilities();
    expect(capabilities.deviceId).toBe("abc");
    expect(capabilities.capabilities.localPrinterBridge).toBe(true);
    expect(capabilities.capabilities.usb).toBe(false);
    expect(capabilities.network.subnet).toBe("192.168.1");
  });

  it("refuses a public address before anything reaches the native side", async () => {
    const { channel, seen } = fakeNative({ PRINT_RECEIPT: () => ({ duplicate: false, bytes: 10 }) });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const outcome = await provider.printReceipt({ id: "job-1", kind: "RECEIPT", connection: { connectionType: "LAN", host: "8.8.8.8", port: 9100 }, data: Uint8Array.from([1, 2, 3]) });
    expect(outcome.printed).toBe(false);
    if (!outcome.printed) expect(outcome.code).toBe("INVALID_ADDRESS");
    expect(seen).toHaveLength(0);
  });

  it("sends a print job as base64 with its id, and reports duplicates", async () => {
    const { channel, seen } = fakeNative({ PRINT_RECEIPT: (payload) => ({ duplicate: payload.jobId === "printed-before", bytes: 3 }) });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const job = { id: "job-1", kind: "RECEIPT" as const, connection: { connectionType: "LAN" as const, host: "192.168.1.50", port: 9100 }, data: Uint8Array.from([1, 2, 3]) };
    const first = await provider.printReceipt(job);
    expect(first).toEqual({ printed: true, duplicate: false, bytes: 3 });
    expect(seen[0]).toEqual({ op: "PRINT_RECEIPT", payload: { jobId: "job-1", kind: "RECEIPT", host: "192.168.1.50", port: 9100, data: "AQID" } });
    const again = await provider.printReceipt({ ...job, id: "printed-before" });
    expect(again).toEqual({ printed: true, duplicate: true, bytes: 3 });
  });

  it("turns a native failure into a value, never a throw", async () => {
    const { channel } = fakeNative({
      PRINT_RECEIPT: () => {
        throw new Error("connect ECONNREFUSED 192.168.1.50:9100");
      },
    });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const outcome = await provider.printReceipt({ id: "j", kind: "RECEIPT", connection: { connectionType: "LAN", host: "192.168.1.50", port: 9100 }, data: new Uint8Array() });
    expect(outcome).toEqual({ printed: false, error: "connect ECONNREFUSED 192.168.1.50:9100", code: "PRINTER_UNREACHABLE" });
  });

  it("times out a request the native side never answers", async () => {
    vi.useFakeTimers();
    const channel: NativeChannel = { onmessage: null, postMessage: () => undefined };
    const transport = new BridgeTransport(channel);
    const pending = transport.request("STATUS", {}, 100);
    vi.advanceTimersByTime(101);
    await expect(pending).rejects.toMatchObject({ code: "PRINTER_TIMEOUT" });
    vi.useRealTimers();
  });

  it("ignores malformed and unknown replies", () => {
    const channel: NativeChannel = { onmessage: null, postMessage: () => undefined };
    const transport = new BridgeTransport(channel);
    expect(() => channel.onmessage?.({ data: "not json" })).not.toThrow();
    expect(() => channel.onmessage?.({ data: JSON.stringify({ v: 1, id: "nobody", ok: true }) })).not.toThrow();
    expect(() => transport.receive(42)).not.toThrow();
  });

  it("filters discovery results to private addresses", async () => {
    const { channel } = fakeNative({ DISCOVER: () => ({ printers: [{ host: "192.168.1.105", port: 9100, latencyMs: 12 }, { host: "1.1.1.1", port: 9100 }, { host: "junk" }] }) });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const found = await provider.discover({ timeoutMs: 100 });
    expect(found).toEqual([{ host: "192.168.1.105", port: 9100, hostname: null, latencyMs: 12 }]);
  });

  it("status is a real report or ERROR — never ONLINE by default", async () => {
    const { channel } = fakeNative({ STATUS: () => ({ status: "OFFLINE", connection: { host: "192.168.1.50", port: 9100 }, checkedAt: "2026-09-13T09:00:00Z", error: "Connection refused" }) });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const status = await provider.getStatus();
    expect(status.status).toBe("OFFLINE");
    expect(status.connection?.host).toBe("192.168.1.50");
    const silent = createNativePrinterProvider(new BridgeTransport({ onmessage: null, postMessage: () => undefined }));
    const timedOut = silent.getStatus();
    await vi.waitFor(() => undefined);
    expect((await Promise.race([timedOut, new Promise((resolve) => setTimeout(() => resolve({ status: "pending" }), 50))])) as { status: string }).toEqual({ status: "pending" });
  });
});

describe("getPrinterClient", () => {
  it("returns the browser client, with no fake hardware, when there is no bridge", async () => {
    const win = {} as Window;
    const client = getPrinterClient(win);
    expect(client.kind).toBe("browser");
    expect(client.supported).toBe(false);
    expect(await client.getCapabilities()).toEqual({ supported: false, reason: "LOCAL_PRINTER_BRIDGE_UNAVAILABLE" });
    expect((await client.getStatus()).status).toBe("UNAVAILABLE");
    if (client.kind !== "browser") throw new Error("expected the browser client");
    expect(await client.printReceipt()).toMatchObject({ printed: false, code: "LOCAL_PRINTER_BRIDGE_UNAVAILABLE" });
    expect(await client.discover()).toEqual({ supported: false, reason: "LOCAL_PRINTER_BRIDGE_UNAVAILABLE" });
    expect(win.FRYPOS).toBeUndefined();
  });

  it("installs window.FRYPOS.printer over the native channel, once", () => {
    const { channel } = fakeNative({});
    const win = { FRYPOS_NATIVE: channel } as unknown as Window;
    const client = getPrinterClient(win);
    expect(client.kind).toBe("native");
    expect(win.FRYPOS?.printer?.isAvailable()).toBe(true);
    expect(ensureBridge(win)).toBe(win.FRYPOS?.printer);
  });
});

import { describe, expect, it, vi } from "vitest";
import { getPrinterClient } from "@/lib/printer/client";
import { BridgeTransport, type NativeChannel, createNativePrinterProvider, createNativeShareProvider, ensureBridge, ensureShareBridge } from "./bridge";
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
    expect(seen[0]).toEqual({ op: "PRINT_RECEIPT", payload: { jobId: "job-1", kind: "RECEIPT", transport: "LAN", host: "192.168.1.50", port: 9100, data: "AQID" } });
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
    expect(found).toEqual([{ transport: "LAN", host: "192.168.1.105", port: 9100, hostname: null, latencyMs: 12 }]);
  });

  it("Bluetooth: scans paired and nearby devices, connects by address, prints through the same PRINT_RECEIPT", async () => {
    const { channel, seen } = fakeNative({
      BT_STATE: () => ({ supported: true, enabled: true, permission: "granted", connected: false, selected: null, error: null }),
      DISCOVER: (payload) => (payload.transport === "BLUETOOTH" ? { printers: [{ address: "66:22:aa:bb:cc:dd", name: "KP307-UEWB", paired: true }, { address: "bad", name: "x" }] } : { printers: [] }),
      CONNECT: (payload) => ({ status: "ONLINE", connection: { address: payload.address, name: payload.name }, checkedAt: "2026-09-13T09:00:00Z", error: null }),
      PRINT_RECEIPT: (payload) => ({ duplicate: false, bytes: payload.transport === "BLUETOOTH" ? 3 : 0 }),
    });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    expect((await provider.getBluetoothState()).enabled).toBe(true);
    const found = await provider.discover({ transport: "BLUETOOTH", timeoutMs: 100 });
    expect(found).toEqual([{ transport: "BLUETOOTH", address: "66:22:AA:BB:CC:DD", name: "KP307-UEWB", paired: true }]);
    const status = await provider.connect({ connectionType: "BLUETOOTH", address: "66:22:aa:bb:cc:dd", name: "KP307-UEWB" });
    expect(status.status).toBe("ONLINE");
    expect(status.connection).toEqual({ connectionType: "BLUETOOTH", address: "66:22:AA:BB:CC:DD", name: "KP307-UEWB" });
    const outcome = await provider.printReceipt({ id: "bt-job", kind: "RECEIPT", connection: { connectionType: "BLUETOOTH", address: "66:22:AA:BB:CC:DD", name: null }, data: Uint8Array.from([1, 2, 3]) });
    expect(outcome).toEqual({ printed: true, duplicate: false, bytes: 3 });
    expect(seen.at(-1)).toEqual({ op: "PRINT_RECEIPT", payload: { jobId: "bt-job", kind: "RECEIPT", transport: "BLUETOOTH", address: "66:22:AA:BB:CC:DD", name: null, data: "AQID" } });
    const refused = await provider.printReceipt({ id: "bt-job-2", kind: "RECEIPT", connection: { connectionType: "BLUETOOTH", address: "not-a-mac", name: null }, data: new Uint8Array() });
    expect(refused).toMatchObject({ printed: false, code: "INVALID_ADDRESS" });
  });

  it("Bluetooth: a disconnected printer is reported, never invented", async () => {
    const { channel } = fakeNative({
      BT_STATE: () => ({ supported: true, enabled: false, permission: "denied", connected: false, selected: { address: "66:22:AA:BB:CC:DD", name: "KP307-UEWB" }, error: "Bluetooth is off" }),
    });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const state = await provider.getBluetoothState();
    expect(state).toEqual({ supported: true, enabled: false, permission: "denied", connected: false, selected: { address: "66:22:AA:BB:CC:DD", name: "KP307-UEWB" }, error: "Bluetooth is off" });
    const browser = getPrinterClient({} as Window);
    expect((await browser.getBluetoothState()).supported).toBe(false);
    expect((await browser.enableBluetooth()).enabled).toBe(false);
  });

  it("Bluetooth: turning the radio on goes through the native dialog and returns the real state", async () => {
    let radio = false;
    const { channel, seen } = fakeNative({
      BT_ENABLE: () => {
        radio = true;
        return { supported: true, enabled: radio, permission: "granted", connected: false, selected: null, error: null };
      },
    });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const state = await provider.enableBluetooth();
    expect(seen[0]?.op).toBe("BT_ENABLE");
    expect(state.enabled).toBe(true);
    const refused = createNativePrinterProvider(new BridgeTransport(fakeNative({ BT_ENABLE: () => Promise.reject(Object.assign(new Error("Bluetooth permission was denied."), {})) }).channel));
    const denied = await refused.enableBluetooth();
    expect(denied.enabled).toBe(false);
    expect(denied.error).toContain("denied");
  });

  it("status is a real report or ERROR — never ONLINE by default", async () => {
    const { channel } = fakeNative({ STATUS: () => ({ status: "OFFLINE", connection: { host: "192.168.1.50", port: 9100 }, checkedAt: "2026-09-13T09:00:00Z", error: "Connection refused" }) });
    const provider = createNativePrinterProvider(new BridgeTransport(channel));
    const status = await provider.getStatus();
    expect(status.status).toBe("OFFLINE");
    expect(status.connection?.connectionType === "LAN" && status.connection.host).toBe("192.168.1.50");
    const silent = createNativePrinterProvider(new BridgeTransport({ onmessage: null, postMessage: () => undefined }));
    const timedOut = silent.getStatus();
    await vi.waitFor(() => undefined);
    expect((await Promise.race([timedOut, new Promise((resolve) => setTimeout(() => resolve({ status: "pending" }), 50))])) as { status: string }).toEqual({ status: "pending" });
  });
});

describe("share bridge", () => {
  it("sends the image as base64 with its mime type, filename and text, and reports the chooser was launched", async () => {
    const { channel, seen } = fakeNative({ SHARE: () => ({ shared: true }) });
    const provider = createNativeShareProvider(new BridgeTransport(channel));
    const outcome = await provider.share({ data: "AQID", mimeType: "image/jpeg", filename: "FRYBIRD-Order-1226-Invoice.jpg", text: "Thanks for choosing FRYBIRD!" });
    expect(outcome).toEqual({ shared: true });
    expect(seen[0]).toEqual({ op: "SHARE", payload: { data: "AQID", mimeType: "image/jpeg", filename: "FRYBIRD-Order-1226-Invoice.jpg", text: "Thanks for choosing FRYBIRD!" } });
  });

  it("turns a native share failure into a value, never a throw", async () => {
    const { channel } = fakeNative({
      SHARE: () => {
        throw new Error("Only JPEG or PNG images can be shared.");
      },
    });
    const provider = createNativeShareProvider(new BridgeTransport(channel));
    const outcome = await provider.share({ data: "AQID", mimeType: "image/jpeg", filename: "x.jpg" });
    expect(outcome).toEqual({ shared: false, error: "Only JPEG or PNG images can be shared.", code: "PRINTER_UNREACHABLE" });
  });

  it("an app version without the SHARE operation fails the same way any unknown op does", async () => {
    const { channel } = fakeNative({}); // no SHARE handler — matches an older installed app
    const provider = createNativeShareProvider(new BridgeTransport(channel));
    const outcome = await provider.share({ data: "AQID", mimeType: "image/jpeg", filename: "x.jpg" });
    expect(outcome.shared).toBe(false);
  });

  it("ensureShareBridge installs window.FRYPOS.share over the same channel ensureBridge uses for printing", () => {
    const { channel } = fakeNative({ CAPABILITIES: () => ({}), SHARE: () => ({ shared: true }) });
    const win = { FRYPOS_NATIVE: channel } as unknown as Window;
    const printer = ensureBridge(win);
    const share = ensureShareBridge(win);
    expect(printer).not.toBeNull();
    expect(share).not.toBeNull();
    expect(win.FRYPOS?.printer).toBe(printer);
    expect(win.FRYPOS?.share).toBe(share);
    // Same object on a second call — installed once, not re-created.
    expect(ensureShareBridge(win)).toBe(share);
  });

  it("is null in a plain browser, same as the printer bridge", () => {
    expect(ensureShareBridge({} as Window)).toBeNull();
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

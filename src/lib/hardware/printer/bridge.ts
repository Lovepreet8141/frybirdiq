/**
 * The shim between the page and the native bridge.
 *
 * Android exposes one origin-restricted object, `window.FRYPOS_NATIVE`
 * (WebViewCompat.addWebMessageListener), with a `postMessage(string)` and a
 * message event back. This file turns that into `window.FRYPOS.printer`, the
 * promise-based `PrinterProvider` the rest of the app feature-detects.
 *
 * Every request carries an id and a timeout; every reply is matched to its
 * request; anything malformed is dropped. Only the operations in
 * `BRIDGE_OPS` exist, and a printer address is validated here before it is
 * ever sent — the native side validates it again.
 */

import { validatePrinterAddress } from "../net";
import { bytesToBase64 } from "./escpos";
import { BRIDGE_OPS, BRIDGE_PROTOCOL_VERSION, type BridgeCapabilities, type BridgeErrorCode, type BridgeOp, type BridgeRequest, type BridgeResponse, type DiscoveredPrinter, type PrintOutcome, type PrinterConnection, type PrinterJob, type PrinterProvider, type StatusReport } from "./types";

export interface NativeChannel {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
  addEventListener?(type: "message", listener: (event: { data: string }) => void): void;
}

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;
const PRINT_TIMEOUT_MS = 30_000;
const DISCOVER_TIMEOUT_MS = 20_000;

function parseResponse(raw: unknown): BridgeResponse | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const message = parsed as Record<string, unknown>;
    if (message.v !== BRIDGE_PROTOCOL_VERSION || typeof message.id !== "string" || typeof message.ok !== "boolean") return null;
    if (message.ok) return { v: 1, id: message.id, ok: true, result: message.result };
    const error = (message.error ?? {}) as Record<string, unknown>;
    return { v: 1, id: message.id, ok: false, error: { code: (typeof error.code === "string" ? error.code : "BRIDGE_ERROR") as BridgeErrorCode, message: typeof error.message === "string" ? error.message : "The printer bridge reported an error." } };
  } catch {
    return null;
  }
}

/** Request/response over the native channel. One instance per page. */
export class BridgeTransport {
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: BridgeError) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;

  constructor(
    private readonly channel: NativeChannel,
    private readonly mintId: () => string = () => `${Date.now().toString(36)}-${(++this.seq).toString(36)}`,
  ) {
    const listener = (event: { data: string }) => this.receive(event.data);
    if (channel.addEventListener) channel.addEventListener("message", listener);
    else channel.onmessage = listener;
  }

  receive(data: unknown): void {
    const response = parseResponse(data);
    if (!response) return;
    const waiting = this.pending.get(response.id);
    if (!waiting) return;
    this.pending.delete(response.id);
    clearTimeout(waiting.timer);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new BridgeError(response.error.code, response.error.message));
  }

  request(op: BridgeOp, payload: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (!BRIDGE_OPS.includes(op)) return Promise.reject(new BridgeError("INVALID_REQUEST", `Unknown bridge operation ${op}.`));
    const id = this.mintId();
    const request: BridgeRequest = { v: BRIDGE_PROTOCOL_VERSION, id, op, payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("PRINTER_TIMEOUT", `The printer bridge did not answer ${op} in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.channel.postMessage(JSON.stringify(request));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new BridgeError("BRIDGE_ERROR", error instanceof Error ? error.message : "Could not reach the printer bridge."));
      }
    });
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const str = (value: unknown, fallback: string | null = null): string | null => (typeof value === "string" ? value : fallback);

function toStatus(result: unknown): StatusReport {
  const record = asRecord(result);
  const status = str(record.status) ?? "UNKNOWN";
  const connection = asRecord(record.connection);
  return {
    status: (["ONLINE", "OFFLINE", "CONNECTING", "ERROR", "UNKNOWN"].includes(status) ? status : "UNKNOWN") as StatusReport["status"],
    connection: typeof connection.host === "string" && typeof connection.port === "number" ? { connectionType: "LAN", host: connection.host, port: connection.port } : null,
    checkedAt: str(record.checkedAt),
    error: str(record.error),
  };
}

function toOutcome(result: unknown): PrintOutcome {
  const record = asRecord(result);
  return { printed: true, duplicate: record.duplicate === true, bytes: typeof record.bytes === "number" ? record.bytes : 0 };
}

function failed(error: unknown): PrintOutcome {
  if (error instanceof BridgeError) return { printed: false, error: error.message, code: error.code };
  return { printed: false, error: error instanceof Error ? error.message : "Printing failed.", code: "BRIDGE_ERROR" };
}

function checkedAddress(connection: PrinterConnection): { host: string; port: number } {
  const checked = validatePrinterAddress(connection.host, connection.port);
  if (!checked.ok) throw new BridgeError("INVALID_ADDRESS", checked.message);
  return { host: checked.host, port: checked.port };
}

/** `window.FRYPOS.printer`, built over a transport. */
export function createNativePrinterProvider(transport: BridgeTransport): PrinterProvider {
  return {
    isAvailable: () => true,

    async getCapabilities(): Promise<BridgeCapabilities> {
      const record = asRecord(await transport.request("CAPABILITIES"));
      const capabilities = asRecord(record.capabilities);
      const network = asRecord(record.network);
      return {
        deviceId: str(record.deviceId),
        deviceName: str(record.deviceName) ?? "POS device",
        platform: (str(record.platform) ?? "ANDROID") as BridgeCapabilities["platform"],
        deviceType: (str(record.deviceType) ?? "TABLET") as BridgeCapabilities["deviceType"],
        model: str(record.model),
        manufacturer: str(record.manufacturer),
        appVersion: str(record.appVersion) ?? "unknown",
        bridgeVersion: str(record.bridgeVersion) ?? "unknown",
        capabilities: {
          printer: capabilities.printer === true,
          localPrinterBridge: capabilities.localPrinterBridge === true,
          wifi: capabilities.wifi === true,
          bluetooth: capabilities.bluetooth === true,
          usb: capabilities.usb === true,
        },
        network: { wifiConnected: network.wifiConnected === true, subnet: str(network.subnet) },
      };
    },

    async getStatus(): Promise<StatusReport> {
      try {
        return toStatus(await transport.request("STATUS"));
      } catch (error) {
        return { status: "ERROR", connection: null, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Status check failed." };
      }
    },

    async discover(options = {}): Promise<readonly DiscoveredPrinter[]> {
      const timeoutMs = options.timeoutMs ?? DISCOVER_TIMEOUT_MS;
      const record = asRecord(await transport.request("DISCOVER", { timeoutMs, port: 9100 }, timeoutMs + 5_000));
      const found = Array.isArray(record.printers) ? record.printers : [];
      return found.flatMap((entry) => {
        const item = asRecord(entry);
        if (typeof item.host !== "string" || !validatePrinterAddress(item.host, 9100).ok) return [];
        return [{ host: item.host, port: typeof item.port === "number" ? item.port : 9100, hostname: str(item.hostname), latencyMs: typeof item.latencyMs === "number" ? item.latencyMs : null }];
      });
    },

    async connect(connection: PrinterConnection): Promise<StatusReport> {
      const address = checkedAddress(connection);
      return toStatus(await transport.request("CONNECT", address));
    },

    async disconnect(): Promise<void> {
      await transport.request("DISCONNECT");
    },

    async testConnection(connection: PrinterConnection) {
      try {
        const address = checkedAddress(connection);
        const record = asRecord(await transport.request("TEST_CONNECTION", address));
        return { ok: record.ok === true, latencyMs: typeof record.latencyMs === "number" ? record.latencyMs : null, error: str(record.error) };
      } catch (error) {
        return { ok: false, latencyMs: null, error: error instanceof Error ? error.message : "Connection test failed." };
      }
    },

    async testPrint(connection: PrinterConnection, data: Uint8Array): Promise<PrintOutcome> {
      try {
        const address = checkedAddress(connection);
        return toOutcome(await transport.request("TEST_PRINT", { ...address, data: bytesToBase64(data) }, PRINT_TIMEOUT_MS));
      } catch (error) {
        return failed(error);
      }
    },

    async printReceipt(job: PrinterJob): Promise<PrintOutcome> {
      try {
        const address = checkedAddress(job.connection);
        return toOutcome(await transport.request("PRINT_RECEIPT", { jobId: job.id, kind: job.kind, ...address, data: bytesToBase64(job.data) }, PRINT_TIMEOUT_MS));
      } catch (error) {
        return failed(error);
      }
    },

    async getLastError(): Promise<string | null> {
      try {
        return str(asRecord(await transport.request("LAST_ERROR")).error);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Installs `window.FRYPOS.printer` when the native channel is present and
 * nothing has installed it yet. Idempotent. Returns the provider, or null
 * in a plain browser — where nothing is installed and nothing pretends.
 */
export function ensureBridge(win: Window = window): PrinterProvider | null {
  if (win.FRYPOS?.printer) return win.FRYPOS.printer;
  const channel = win.FRYPOS_NATIVE;
  if (!channel || typeof channel.postMessage !== "function") return null;
  const provider = createNativePrinterProvider(new BridgeTransport(channel));
  win.FRYPOS = { ...(win.FRYPOS ?? {}), printer: provider };
  return provider;
}

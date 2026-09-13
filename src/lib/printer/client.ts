/**
 * The printer client the web app uses — one call, two answers.
 *
 * On a device with the FRYBIRD native bridge, `getPrinterClient()` returns
 * a client backed by `window.FRYPOS.printer`. Everywhere else it returns
 * the browser client, whose every operation says plainly that direct
 * thermal printing is not available here. The browser client never fakes
 * a print, a status or a discovery.
 */

import { ensureBridge } from "@/lib/hardware/printer/bridge";
import type { BridgeCapabilities, DiscoveredPrinter, PrintOutcome, PrinterConnection, PrinterJob, PrinterProvider, StatusReport } from "@/lib/hardware/printer/types";

export const UNAVAILABLE_REASON = "LOCAL_PRINTER_BRIDGE_UNAVAILABLE" as const;

export type Unsupported = { readonly supported: false; readonly reason: typeof UNAVAILABLE_REASON };

export interface NativePrinterClient {
  readonly kind: "native";
  readonly supported: true;
  readonly provider: PrinterProvider;
  getCapabilities(): Promise<BridgeCapabilities>;
  getStatus(): Promise<StatusReport>;
  discover(options?: { timeoutMs?: number }): Promise<readonly DiscoveredPrinter[]>;
  connect(connection: PrinterConnection): Promise<StatusReport>;
  disconnect(): Promise<void>;
  testConnection(connection: PrinterConnection): Promise<{ ok: boolean; latencyMs: number | null; error: string | null }>;
  testPrint(connection: PrinterConnection, data: Uint8Array): Promise<PrintOutcome>;
  printReceipt(job: PrinterJob): Promise<PrintOutcome>;
  getLastError(): Promise<string | null>;
}

/** Same call shapes as the native client, so callers switch on `supported` rather than on method presence. */
export interface BrowserPrinterClient {
  readonly kind: "browser";
  readonly supported: false;
  readonly reason: typeof UNAVAILABLE_REASON;
  getCapabilities(): Promise<Unsupported>;
  getStatus(): Promise<StatusReport>;
  discover(options?: { timeoutMs?: number }): Promise<Unsupported>;
  connect(connection?: PrinterConnection): Promise<Unsupported>;
  disconnect(): Promise<void>;
  testConnection(connection?: PrinterConnection): Promise<Unsupported>;
  testPrint(connection?: PrinterConnection, data?: Uint8Array): Promise<PrintOutcome>;
  printReceipt(job?: PrinterJob): Promise<PrintOutcome>;
  getLastError(): Promise<null>;
}

export type PrinterClient = NativePrinterClient | BrowserPrinterClient;

const unsupported: Unsupported = { supported: false, reason: UNAVAILABLE_REASON };
const notPrinted: PrintOutcome = { printed: false, error: "Direct thermal printing is available on a configured POS device.", code: UNAVAILABLE_REASON };

export const browserPrinterClient: BrowserPrinterClient = {
  kind: "browser",
  supported: false,
  reason: UNAVAILABLE_REASON,
  getCapabilities: async () => unsupported,
  getStatus: async () => ({ status: "UNAVAILABLE", connection: null, checkedAt: null, error: null }),
  discover: async () => unsupported,
  connect: async () => unsupported,
  disconnect: async () => undefined,
  testConnection: async () => unsupported,
  testPrint: async () => notPrinted,
  printReceipt: async () => notPrinted,
  getLastError: async () => null,
};

export function nativePrinterClient(provider: PrinterProvider): NativePrinterClient {
  return {
    kind: "native",
    supported: true,
    provider,
    getCapabilities: () => provider.getCapabilities(),
    getStatus: () => provider.getStatus(),
    discover: (options) => provider.discover(options),
    connect: (connection) => provider.connect(connection),
    disconnect: () => provider.disconnect(),
    testConnection: (connection) => provider.testConnection(connection),
    testPrint: (connection, data) => provider.testPrint(connection, data),
    printReceipt: (job) => provider.printReceipt(job),
    getLastError: () => provider.getLastError(),
  };
}

/** Native when `window.FRYPOS.printer` exists (or can be installed over the native channel); the browser client otherwise. */
export function getPrinterClient(win: Window | undefined = typeof window === "undefined" ? undefined : window): PrinterClient {
  if (!win) return browserPrinterClient;
  const provider = ensureBridge(win);
  return provider ? nativePrinterClient(provider) : browserPrinterClient;
}

/**
 * The hardware layer's vocabulary, shared by the web app, the bridge shim
 * and the server. Pure types and constants — no React, no DB.
 *
 * The web application never depends on Android. It talks to a
 * `PrinterProvider` (the local bridge on whatever device it is running on)
 * and the bridge talks to the printer over the shop's own LAN. On a plain
 * browser there is no provider, and nothing here pretends otherwise.
 */

export type DeviceType = "DESKTOP" | "TABLET" | "PHONE" | "POS_TERMINAL";
export type DevicePlatform = "WEB" | "ANDROID" | "IOS" | "WINDOWS" | "MACOS" | "LINUX";
export type PrinterConnectionType = "LAN" | "BLUETOOTH" | "USB";

/** What a device reports it can do — reported by the device, never assumed. */
export interface HardwareCapabilities {
  readonly printer: boolean;
  readonly localPrinterBridge: boolean;
  readonly wifi: boolean;
  readonly bluetooth: boolean;
  readonly usb: boolean;
}

export const NO_HARDWARE: HardwareCapabilities = { printer: false, localPrinterBridge: false, wifi: false, bluetooth: false, usb: false };

/**
 * Real statuses only. `UNAVAILABLE` is what a plain browser reports —
 * there is no bridge to ask — and is never dressed up as `ONLINE`.
 */
export type PrinterStatus = "ONLINE" | "OFFLINE" | "CONNECTING" | "ERROR" | "UNKNOWN" | "UNAVAILABLE";

/** How the bridge reaches one printer. Never a public address. */
export interface PrinterConnection {
  readonly connectionType: PrinterConnectionType;
  readonly host: string;
  readonly port: number;
}

export interface PrinterCapabilities {
  readonly paperWidthMm: 58 | 80;
  /** Dots across the print head. 576 for an 80 mm roll, 384 for 58 mm. */
  readonly dotsPerLine: number;
  readonly protocol: "ESC/POS";
  readonly cutter: boolean;
  readonly raster: boolean;
  readonly qr: boolean;
}

export const CAPABILITIES_80MM: PrinterCapabilities = { paperWidthMm: 80, dotsPerLine: 576, protocol: "ESC/POS", cutter: true, raster: true, qr: true };
export const CAPABILITIES_58MM: PrinterCapabilities = { paperWidthMm: 58, dotsPerLine: 384, protocol: "ESC/POS", cutter: true, raster: true, qr: true };

export type PrintJobKind = "RECEIPT" | "DUPLICATE" | "TEST";
export type PrintJobStatus = "QUEUED" | "PRINTING" | "PRINTED" | "FAILED";

/** One thing to put on paper. `data` is ESC/POS bytes; the bridge never interprets them. */
export interface PrinterJob {
  readonly id: string;
  readonly kind: PrintJobKind;
  readonly connection: PrinterConnection;
  readonly data: Uint8Array;
}

export interface StatusReport {
  readonly status: PrinterStatus;
  readonly connection: PrinterConnection | null;
  readonly checkedAt: string | null;
  readonly error: string | null;
}

export interface DiscoveredPrinter {
  readonly host: string;
  readonly port: number;
  readonly hostname: string | null;
  readonly latencyMs: number | null;
}

/** What the native side says about the device it runs on. */
export interface BridgeCapabilities {
  readonly deviceId: string | null;
  readonly deviceName: string;
  readonly platform: DevicePlatform;
  readonly deviceType: DeviceType;
  readonly model: string | null;
  readonly manufacturer: string | null;
  readonly appVersion: string;
  readonly bridgeVersion: string;
  readonly capabilities: HardwareCapabilities;
  readonly network: { readonly wifiConnected: boolean; readonly subnet: string | null };
}

export type PrintOutcome = { readonly printed: true; readonly duplicate: boolean; readonly bytes: number } | { readonly printed: false; readonly error: string; readonly code: BridgeErrorCode };

export type BridgeErrorCode =
  | "LOCAL_PRINTER_BRIDGE_UNAVAILABLE"
  | "PRINTER_UNREACHABLE"
  | "PRINTER_TIMEOUT"
  | "INVALID_ADDRESS"
  | "INVALID_REQUEST"
  | "NOT_ON_WIFI"
  | "BRIDGE_ERROR";

/**
 * The bridge as the web application sees it — `window.FRYPOS.printer`.
 * Every method resolves; a failure is a value, never a thrown string.
 */
export interface PrinterProvider {
  isAvailable(): boolean;
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

/* ------------------------------------------------------------------ */
/* Wire protocol between the shim and the native bridge                */
/* ------------------------------------------------------------------ */

/** The only operations the native side accepts. Anything else is refused. */
export const BRIDGE_OPS = ["CAPABILITIES", "STATUS", "DISCOVER", "CONNECT", "DISCONNECT", "TEST_CONNECTION", "TEST_PRINT", "PRINT_RECEIPT", "LAST_ERROR"] as const;
export type BridgeOp = (typeof BRIDGE_OPS)[number];

export interface BridgeRequest {
  readonly v: 1;
  readonly id: string;
  readonly op: BridgeOp;
  readonly payload: Record<string, unknown>;
}

export type BridgeResponse = { readonly v: 1; readonly id: string; readonly ok: true; readonly result: unknown } | { readonly v: 1; readonly id: string; readonly ok: false; readonly error: { readonly code: BridgeErrorCode; readonly message: string } };

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

declare global {
  interface Window {
    /** Installed by the shim when a native bridge is present. Absent in a plain browser. */
    FRYPOS?: { printer?: PrinterProvider; bridgeVersion?: string };
    /** Injected by the Android WebView for the trusted origin only (WebViewCompat.addWebMessageListener). */
    FRYPOS_NATIVE?: { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null; addEventListener?(type: "message", listener: (event: { data: string }) => void): void };
  }
}

"use client";

/**
 * The device's own agent: knows what it is, registers when it has a
 * bridge, heartbeats while a POS screen is open, watches its printer, and
 * prints. One provider, mounted by the POS page and the Hardware page;
 * everything below reads it through `useLocalPrinter()`.
 *
 * Facts only. On a plain browser the client is the browser client, the
 * status is UNAVAILABLE, and no device row is created unless a person
 * asks for one. With the FRYBIRD native bridge the device registers
 * itself on first load and the printer status comes from a real TCP
 * probe on the shop's LAN — never from the cloud.
 */

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type DeviceIdentity, describeDevice, loadOrMintDeviceKey } from "@/lib/hardware/device";
import { createPrintJobAction, heartbeatAction, registerDeviceAction, reportPrintJobAction, reportPrinterStatusAction, whoAmIAction } from "@/lib/hardware/actions";
import { loadReceiptImages } from "@/lib/hardware/printer/bitmap";
import { receiptToEscPos, testTicket } from "@/lib/hardware/printer/escpos";
import type { BridgeCapabilities, PrintJobKind, PrinterConnection, PrinterStatus } from "@/lib/hardware/printer/types";
import { type PrinterClient, getPrinterClient } from "@/lib/printer/client";
import type { ReceiptData } from "@/lib/receipt/data";
import type { ReceiptTemplate } from "@/lib/receipt/template";
import type { DeviceRecord, PrinterRecord } from "@/lib/repositories/hardware";

export type PrintResult = { readonly ok: true; readonly jobId: string; readonly duplicate: boolean } | { readonly ok: false; readonly jobId: string | null; readonly error: string; readonly retryable: boolean };

export interface LocalPrinter {
  /** Native on a FRYBIRD POS device; the browser client everywhere else. */
  readonly client: PrinterClient;
  readonly bridge: BridgeCapabilities | null;
  readonly identity: DeviceIdentity | null;
  /** The server's record for this device, once registered. */
  readonly device: DeviceRecord | null;
  /** The printer bound to this device, if the owner configured one. */
  readonly printer: PrinterRecord | null;
  readonly status: PrinterStatus;
  readonly statusError: string | null;
  readonly ready: boolean;
  register(): Promise<{ ok: true } | { ok: false; error: string }>;
  refreshStatus(): Promise<PrinterStatus>;
  reconnect(): Promise<PrinterStatus>;
  setPrinter(printer: PrinterRecord | null): void;
  printReceipt(input: { orderId: string; template: ReceiptTemplate; data: ReceiptData; kind: "RECEIPT" | "DUPLICATE"; jobId?: string }): Promise<PrintResult>;
  testPrint(printer: PrinterRecord, shopName: string): Promise<PrintResult>;
  /** A test ticket to a connection that is not saved yet (the Add Printer screen). No job record — there is no printer row to attach one to. */
  testPrintConnection(input: { connection: PrinterConnection; printerName: string; paperWidthMm: 58 | 80; shopName: string }): Promise<PrintResult>;
  testConnection(connection: PrinterConnection): Promise<{ ok: boolean; latencyMs: number | null; error: string | null }>;
}

const LocalPrinterContext = createContext<LocalPrinter | null>(null);

export function useLocalPrinter(): LocalPrinter | null {
  return useContext(LocalPrinterContext);
}

const HEARTBEAT_MS = 60_000;
const STATUS_POLL_MS = 30_000;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? null;

/** The bridge's view of a saved printer: a LAN address, or the Bluetooth device the tablet was paired with. */
export const connectionOf = (printer: PrinterRecord): PrinterConnection | null => {
  if (printer.connectionType === "BLUETOOTH") return printer.bluetoothIdentifier ? { connectionType: "BLUETOOTH", address: printer.bluetoothIdentifier, name: printer.name } : null;
  if (printer.connectionType === "LAN") return printer.ipAddress ? { connectionType: "LAN", host: printer.ipAddress, port: printer.port } : null;
  return null;
};

export function DeviceAgent({ children, autoRegister = true, initialPrinter = null }: { children: ReactNode; /** Register a bridge device on load. Browsers never auto-register. */ autoRegister?: boolean; initialPrinter?: PrinterRecord | null }) {
  const [client] = useState<PrinterClient>(() => getPrinterClient());
  const [bridge, setBridge] = useState<BridgeCapabilities | null>(null);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [printer, setPrinter] = useState<PrinterRecord | null>(initialPrinter);
  const [status, setStatus] = useState<PrinterStatus>(client.supported ? "UNKNOWN" : "UNAVAILABLE");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const printerRef = useRef(printer);
  const backoff = useRef(0);
  // Keep the ref in step with state from an effect, not during render.
  useEffect(() => {
    printerRef.current = printer;
  }, [printer]);

  // Who am I? Bridge facts if there is a bridge, browser facts otherwise. DOM reads belong in an effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let capabilities: BridgeCapabilities | null = null;
      if (client.supported) {
        try {
          capabilities = await client.getCapabilities();
        } catch {
          capabilities = null;
        }
      }
      const key = loadOrMintDeviceKey(typeof localStorage === "undefined" ? null : localStorage, () => crypto.randomUUID());
      if (cancelled) return;
      setBridge(capabilities);
      if (!key && !capabilities?.deviceId) {
        setReady(true);
        return;
      }
      const described = describeDevice({ deviceKey: key ?? "", userAgent: navigator.userAgent, viewportWidth: window.innerWidth, appVersion: APP_VERSION, bridge: capabilities });
      setIdentity(described);
      const known = await whoAmIAction(described.deviceKey);
      if (cancelled) return;
      if (known.ok) {
        setDevice(known.device);
        if (known.printer) setPrinter(known.printer);
        if (!known.device && autoRegister && capabilities?.capabilities.localPrinterBridge) {
          const registered = await registerDeviceAction(described);
          if (!cancelled && registered.ok) {
            setDevice(registered.device);
            setPrinter(registered.printer);
          }
        }
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, autoRegister]);

  const probe = useCallback(async (): Promise<PrinterStatus> => {
    const current = printerRef.current;
    if (!client.supported) {
      setStatus("UNAVAILABLE");
      return "UNAVAILABLE";
    }
    const connection = current ? connectionOf(current) : null;
    if (!connection) {
      setStatus("UNKNOWN");
      setStatusError(null);
      return "UNKNOWN";
    }
    const report = await client.connect(connection).catch(() => null);
    const next: PrinterStatus = report?.status ?? "ERROR";
    setStatus(next);
    setStatusError(report?.error ?? null);
    backoff.current = next === "ONLINE" ? 0 : Math.min(backoff.current + 1, 4);
    if (current && identity) void reportPrinterStatusAction({ deviceKey: identity.deviceKey, printerId: current.id, status: next, error: report?.error ?? null });
    return next;
  }, [client, identity]);

  // Watch the printer while the screen is open: every 30 s when it answers,
  // backing off to 8 minutes when it does not — never hammering it.
  useEffect(() => {
    if (!client.supported || !printer) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await probe();
      timer = setTimeout(tick, STATUS_POLL_MS * 2 ** backoff.current);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, printer, probe]);

  // Heartbeat: once a minute while visible, only for a registered device.
  useEffect(() => {
    if (!device || !identity) return;
    let stopped = false;
    const beat = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const result = await heartbeatAction({
        deviceKey: identity.deviceKey,
        appVersion: identity.appVersion,
        bridgeVersion: identity.bridgeVersion,
        capabilities: identity.capabilities,
        printerId: printerRef.current?.id ?? null,
        printerStatus: client.supported ? status : "UNAVAILABLE",
        printerError: statusError,
      }).catch(() => null);
      if (!stopped && result?.ok) setPrinter((current) => (JSON.stringify(current) === JSON.stringify(result.printer) ? current : result.printer));
    };
    void beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // status/statusError are read at beat time; re-arming the interval on every status change would be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, identity, client.supported]);

  const register = useCallback(async () => {
    if (!identity) return { ok: false as const, error: "This device has no storage for a device key, so it cannot register." };
    const result = await registerDeviceAction(identity);
    if (!result.ok) return result;
    setDevice(result.device);
    setPrinter(result.printer);
    return { ok: true as const };
  }, [identity]);

  const send = useCallback(
    async (input: { jobId: string; kind: PrintJobKind; printer: PrinterRecord; data: Uint8Array; orderId: string | null }): Promise<PrintResult> => {
      const connection = connectionOf(input.printer);
      if (!client.supported) return { ok: false, jobId: null, error: "Direct thermal printing is available on a configured POS device.", retryable: false };
      if (!connection) return { ok: false, jobId: null, error: "This printer has no address yet.", retryable: false };
      if (!identity) return { ok: false, jobId: null, error: "This device is not registered.", retryable: false };

      // Record the job first (idempotent on id and on order+RECEIPT). If the
      // cloud is unreachable, still print — the LAN does not need the internet.
      let jobId = input.jobId;
      const created = await createPrintJobAction({ id: input.jobId, orderId: input.orderId, printerId: input.printer.id, deviceKey: identity.deviceKey, kind: input.kind }).catch(() => null);
      if (created && !created.ok) return { ok: false, jobId: null, error: created.error, retryable: false };
      // Reports are awaited in order (PRINTING → PRINTED / FAILED) so the job's
      // history is true; each one fails fast and is ignored when the cloud is away.
      const recorded = Boolean(created?.ok);
      if (created?.ok) {
        jobId = created.job.id;
        if (created.job.status === "PRINTED" && input.kind === "RECEIPT") return { ok: true, jobId, duplicate: true };
        await reportPrintJobAction({ id: jobId, status: "PRINTING", error: null }).catch(() => null);
      }

      const outcome = input.kind === "TEST" ? await client.testPrint(connection, input.data) : await client.printReceipt({ id: jobId, kind: input.kind, connection, data: input.data });
      if (outcome.printed) {
        setStatus("ONLINE");
        setStatusError(null);
        if (recorded) await reportPrintJobAction({ id: jobId, status: "PRINTED", error: null }).catch(() => null);
        return { ok: true, jobId, duplicate: outcome.duplicate };
      }
      setStatus(outcome.code === "PRINTER_UNREACHABLE" || outcome.code === "PRINTER_TIMEOUT" || outcome.code === "PRINTER_DISCONNECTED" || outcome.code === "BLUETOOTH_DISABLED" ? "OFFLINE" : "ERROR");
      setStatusError(outcome.error);
      if (recorded) await reportPrintJobAction({ id: jobId, status: "FAILED", error: outcome.error }).catch(() => null);
      return { ok: false, jobId, error: outcome.error, retryable: outcome.code !== "INVALID_ADDRESS" && outcome.code !== "INVALID_REQUEST" };
    },
    [client, identity],
  );

  const value = useMemo<LocalPrinter>(
    () => ({
      client,
      bridge,
      identity,
      device,
      printer,
      status,
      statusError,
      ready,
      register,
      refreshStatus: probe,
      reconnect: async () => {
        if (client.supported) await client.disconnect().catch(() => undefined);
        backoff.current = 0;
        setStatus("CONNECTING");
        return probe();
      },
      setPrinter,
      async printReceipt(input) {
        const current = printerRef.current;
        if (!current) return { ok: false, jobId: null, error: "No printer is set up for this device.", retryable: false };
        const dots = current.paperWidthMm === 58 ? 384 : 576;
        const urls = input.template.sections.flatMap((section) => (section.kind === "logo" || section.kind === "paymentQr" ? (section.url ? [section.url] : []) : section.kind === "otherQrs" ? section.codes.flatMap((code) => (code.url ? [code.url] : [])) : []));
        const images = await loadReceiptImages(urls, dots);
        const data = receiptToEscPos({ ...input.template, paperWidthMm: current.paperWidthMm === 58 ? 58 : 79 }, input.data, { paperWidthMm: current.paperWidthMm, images });
        return send({ jobId: input.jobId ?? crypto.randomUUID(), kind: input.kind, printer: current, data, orderId: input.orderId });
      },
      async testPrint(target, shopName) {
        const data = testTicket({ shopName, deviceName: device?.name ?? identity?.name ?? "this device", printerName: target.name, at: new Date(), paperWidthMm: target.paperWidthMm });
        return send({ jobId: crypto.randomUUID(), kind: "TEST", printer: target, data, orderId: null });
      },
      async testPrintConnection(input) {
        if (!client.supported) return { ok: false, jobId: null, error: "Direct thermal printing is available on a configured POS device.", retryable: false };
        const data = testTicket({ shopName: input.shopName, deviceName: device?.name ?? identity?.name ?? "this device", printerName: input.printerName, at: new Date(), paperWidthMm: input.paperWidthMm });
        const outcome = await client.testPrint(input.connection, data);
        if (outcome.printed) {
          setStatus("ONLINE");
          setStatusError(null);
          return { ok: true, jobId: "test", duplicate: false };
        }
        return { ok: false, jobId: null, error: outcome.error, retryable: outcome.code !== "INVALID_ADDRESS" };
      },
      async testConnection(connection) {
        if (!client.supported) return { ok: false, latencyMs: null, error: "Direct thermal printing is available on a configured POS device." };
        return client.testConnection(connection);
      },
    }),
    [client, bridge, identity, device, printer, status, statusError, ready, register, probe, send],
  );

  return <LocalPrinterContext.Provider value={value}>{children}</LocalPrinterContext.Provider>;
}

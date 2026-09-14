"use client";

/**
 * Add / edit a printer.
 *
 * The screen first says plainly what it is running on — the FRYBIRD POS
 * app with its printer bridge, or a browser with none — because that
 * decides what is possible. Wi-Fi / LAN can always be configured (it is
 * saved against the POS device that prints). Bluetooth appears only when
 * the bridge on this device reports a Bluetooth radio, and every state
 * after that (off, permission, scan results, connected) is what Android
 * actually answered. USB appears only if the bridge says it supports it.
 */

import { useEffect, useState, useTransition } from "react";
import { Bluetooth, Loader2, Printer, Search, Wifi } from "lucide-react";
import { Field, inputClass, selectClass } from "@/components/inventory/field";
import { Button } from "@/components/ui/button";
import { savePrinterAction } from "@/lib/hardware/actions";
import { deviceKindLabel } from "@/lib/hardware/device";
import { validatePrinterAddress } from "@/lib/hardware/net";
import type { BluetoothState, DiscoveredPrinter, PrinterConnectionType, PrinterStatus } from "@/lib/hardware/printer/types";
import type { DeviceRecord, PrinterRecord } from "@/lib/repositories/hardware";
import { cn } from "@/lib/utils";
import { useLocalPrinter } from "./device-agent";
import { OpenPosAppLink } from "./open-pos-app-link";
import { StatusDot } from "./printer-status";

export const POSIFLOW = { model: "POSIFLOW KPC307-UEWB", manufacturer: "POSIFLOW", port: 9100, paperWidthMm: 80 as const, protocol: "ESC/POS" };

type BluetoothDevice = Extract<DiscoveredPrinter, { transport: "BLUETOOTH" }>;

interface FormState {
  deviceId: string;
  name: string;
  model: string;
  manufacturer: string;
  connectionType: PrinterConnectionType;
  ipAddress: string;
  port: string;
  macAddress: string;
  /** Bluetooth: the paired device's address and its advertised name. */
  bluetoothAddress: string;
  bluetoothName: string;
  paperWidthMm: "80" | "58";
  protocol: string;
  isDefault: boolean;
  autoPrintEnabled: boolean;
}

function initial(printer: PrinterRecord | null, devices: readonly DeviceRecord[], thisDeviceId: string | null, firstPrinter: boolean): FormState {
  // A new printer defaults to this device when it has a bridge, else to the first bridge device, else to whatever exists.
  const bridgeDevice = devices.find((device) => device.id === thisDeviceId && device.capabilities.localPrinterBridge) ?? devices.find((device) => device.capabilities.localPrinterBridge) ?? devices[0];
  return {
    deviceId: printer?.deviceId ?? bridgeDevice?.id ?? "",
    name: printer?.name ?? "Receipt Printer",
    model: printer?.model ?? POSIFLOW.model,
    manufacturer: printer?.manufacturer ?? POSIFLOW.manufacturer,
    connectionType: printer?.connectionType ?? "LAN",
    ipAddress: printer?.ipAddress ?? "",
    port: String(printer?.port ?? POSIFLOW.port),
    macAddress: printer?.macAddress ?? "",
    bluetoothAddress: printer?.bluetoothIdentifier ?? "",
    bluetoothName: "",
    paperWidthMm: printer?.paperWidthMm === 58 ? "58" : "80",
    protocol: printer?.protocol ?? POSIFLOW.protocol,
    isDefault: printer?.isDefault ?? firstPrinter,
    autoPrintEnabled: printer?.autoPrintEnabled ?? true,
  };
}

export function PrinterForm({ printer, devices, shopName, firstPrinter, onSaved, onCancel }: { printer: PrinterRecord | null; devices: readonly DeviceRecord[]; shopName: string; firstPrinter: boolean; onSaved: (printer: PrinterRecord) => void; onCancel: () => void }) {
  const local = useLocalPrinter();
  const [form, setForm] = useState<FormState>(() => initial(printer, devices, local?.device?.id ?? null, firstPrinter));
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<readonly DiscoveredPrinter[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverNote, setDiscoverNote] = useState<string | null>(null);
  const [bluetooth, setBluetooth] = useState<BluetoothState | null>(null);
  const [btDevices, setBtDevices] = useState<readonly BluetoothDevice[] | null>(null);
  const [btBusy, setBtBusy] = useState<"scan" | "connect" | "enable" | "test" | "print" | null>(null);
  const [btStatus, setBtStatus] = useState<{ status: PrinterStatus; error: string | null } | null>(null);
  const [btNote, setBtNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [browserContinue, setBrowserContinue] = useState(Boolean(printer));
  const [isPending, startTransition] = useTransition();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const bridge = local?.client.supported ? local.bridge : null;
  const hasBridge = Boolean(local?.client.supported);
  const chosenDevice = devices.find((device) => device.id === form.deviceId) ?? null;
  const thisIsTheDevice = Boolean(hasBridge && local?.device && local.device.id === form.deviceId);
  // What the bridge on THIS device says it can do. Nothing is assumed.
  const bluetoothAvailable = Boolean(bridge?.capabilities.bluetooth);
  const usbAvailable = Boolean(bridge?.capabilities.usb);
  const address = validatePrinterAddress(form.ipAddress, Number(form.port));
  const connection = form.bluetoothAddress ? ({ connectionType: "BLUETOOTH", address: form.bluetoothAddress, name: form.bluetoothName || form.name } as const) : null;

  // Ask the radio how it is the moment Bluetooth is chosen on the bridge device.
  useEffect(() => {
    if (form.connectionType !== "BLUETOOTH" || !local?.client.supported || !thisIsTheDevice) return;
    let cancelled = false;
    void local.client.getBluetoothState().then((state) => {
      if (cancelled) return;
      setBluetooth(state);
      if (state.connected && state.selected) setBtStatus({ status: "ONLINE", error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [form.connectionType, local, thisIsTheDevice]);

  async function discoverLan() {
    if (!local?.client.supported) return;
    setDiscovering(true);
    setDiscoverNote(null);
    try {
      const printers = await local.client.discover({ transport: "LAN", timeoutMs: 15_000 });
      setFound(printers);
      setDiscoverNote(printers.length === 0 ? "Nothing answered on port 9100. Check the printer is on and on the same Wi-Fi, or enter its IP from the printer's self-test page." : null);
    } catch (caught) {
      setFound([]);
      setDiscoverNote(caught instanceof Error ? caught.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  }

  async function enableBluetooth() {
    if (!local?.client.supported) return;
    setBtBusy("enable");
    setBtNote(null);
    const state = await local.client.enableBluetooth();
    setBluetooth(state);
    if (!state.enabled) setBtNote({ tone: "error", text: state.error ?? "Bluetooth is still off." });
    setBtBusy(null);
  }

  async function scanBluetooth() {
    if (!local?.client.supported) return;
    setBtBusy("scan");
    setBtNote(null);
    try {
      const results = await local.client.discover({ transport: "BLUETOOTH", timeoutMs: 15_000 });
      const devicesFound = results.filter((entry): entry is BluetoothDevice => entry.transport === "BLUETOOTH");
      setBtDevices(devicesFound);
      if (devicesFound.length === 0) setBtNote({ tone: "error", text: "No Bluetooth devices found. Switch the printer on, hold it near the tablet, and scan again." });
    } catch (caught) {
      setBtDevices([]);
      setBtNote({ tone: "error", text: caught instanceof Error ? caught.message : "Bluetooth scan failed." });
    } finally {
      setBluetooth(await local.client.getBluetoothState());
      setBtBusy(null);
    }
  }

  async function connectBluetooth(target: { address: string; name: string | null }) {
    if (!local?.client.supported) return;
    setBtBusy("connect");
    setBtNote(null);
    setBtStatus({ status: "CONNECTING", error: null });
    try {
      const report = await local.client.connect({ connectionType: "BLUETOOTH", address: target.address, name: target.name });
      setBtStatus({ status: report.status, error: report.error });
      if (report.status === "ONLINE") {
        setForm((current) => ({ ...current, bluetoothAddress: target.address, bluetoothName: target.name ?? "", name: current.name === "Receipt Printer" && target.name ? target.name : current.name }));
      }
    } catch (caught) {
      setBtStatus({ status: "ERROR", error: caught instanceof Error ? caught.message : "Could not connect." });
    } finally {
      setBtBusy(null);
    }
  }

  async function testBluetoothConnection() {
    if (!local || !connection) return;
    setBtBusy("test");
    setBtNote(null);
    const result = await local.testConnection(connection);
    setBtStatus({ status: result.ok ? "ONLINE" : "OFFLINE", error: result.error });
    setBtNote(result.ok ? { tone: "ok", text: `${connection.name ?? "The printer"} is connected over Bluetooth.` } : { tone: "error", text: result.error ?? "Not connected." });
    setBtBusy(null);
  }

  async function testBluetoothPrint() {
    if (!local || !connection) return;
    setBtBusy("print");
    setBtNote(null);
    const result = await local.testPrintConnection({ connection, printerName: form.name, paperWidthMm: form.paperWidthMm === "58" ? 58 : 80, shopName });
    setBtStatus({ status: result.ok ? "ONLINE" : "OFFLINE", error: result.ok ? null : result.error });
    setBtNote(result.ok ? { tone: "ok", text: `Test ticket sent to ${form.name}. Check the paper.` } : { tone: "error", text: result.error });
    setBtBusy(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.deviceId) {
      setError("Choose the device that is next to the printer.");
      return;
    }
    if (form.connectionType === "LAN" && !address.ok) {
      setError(address.message);
      return;
    }
    if (form.connectionType === "BLUETOOTH" && !form.bluetoothAddress) {
      setError("Scan for the printer and connect to it first, so FRYBIRD knows which Bluetooth device to print to.");
      return;
    }
    startTransition(async () => {
      const result = await savePrinterAction({
        id: printer?.id ?? null,
        deviceId: form.deviceId,
        name: form.name,
        model: form.model || null,
        manufacturer: form.manufacturer || null,
        connectionType: form.connectionType,
        ipAddress: form.ipAddress || null,
        port: Number(form.port),
        macAddress: form.macAddress || null,
        bluetoothIdentifier: form.connectionType === "BLUETOOTH" ? form.bluetoothAddress || null : null,
        paperWidthMm: form.paperWidthMm === "58" ? 58 : 80,
        protocol: form.protocol,
        isDefault: form.isDefault,
        autoPrintEnabled: form.autoPrintEnabled,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.printer);
    });
  }

  const deviceLabel = (device: DeviceRecord) => (device.capabilities.localPrinterBridge ? `${device.name} · FRYBIRD POS` : `${device.name} · ${deviceKindLabel(device)}, no printer bridge`);

  /* ---- A browser: say so, and offer the two honest ways forward. ---- */
  if (!hasBridge && !browserContinue) {
    const platform = local?.identity?.platform ?? null;
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-surface p-4">
          <p className="text-lg font-semibold">{local?.device?.name ?? local?.identity?.name ?? "This browser"}</p>
          <p className="text-sm font-medium text-muted-foreground">No printer bridge</p>
          <p className="mt-2 text-sm">You&rsquo;re running FRYBIRD in a browser. Direct Bluetooth/USB thermal printing requires the FRYBIRD POS app. A browser cannot open a connection to a thermal printer — not over Bluetooth, and not to port 9100 on the Wi-Fi.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenPosAppLink platform={platform} className="min-h-[44px]" />
          <Button type="button" variant="outline" size="lg" onClick={() => setBrowserContinue(true)}>
            <Wifi aria-hidden="true" />
            Continue with Wi-Fi / LAN
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Continuing saves a Wi-Fi / LAN printer against the FRYBIRD POS device that will print to it. The receipt still leaves that device, not this browser.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="border-l-2 border-[var(--destructive)] bg-surface px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {/* THIS DEVICE — the fact that decides everything below. */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <p className="text-base font-semibold">{local?.device?.name ?? local?.identity?.name ?? "This device"}</p>
        {hasBridge ? (
          <p className="text-sm text-muted-foreground">
            ✓ FRYBIRD POS &nbsp; ✓ Printer Bridge Available
            {bridge ? ` · Wi-Fi / LAN${bridge.capabilities.bluetooth ? " · Bluetooth" : ""}${bridge.capabilities.usb ? " · USB" : ""}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Browser · No printer bridge. This printer is saved for the FRYBIRD POS device chosen below.</p>
        )}
      </div>

      <Field id="pf-device" label="Device" hint="The POS device standing next to this printer. Only that device's local bridge will ever talk to it.">
        <select id="pf-device" value={form.deviceId} onChange={(event) => set("deviceId", event.target.value)} className={selectClass} required>
          {devices.length === 0 && <option value="">No registered devices yet</option>}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {deviceLabel(device)}
            </option>
          ))}
        </select>
      </Field>
      {chosenDevice && !chosenDevice.capabilities.localPrinterBridge && <p className="text-xs text-destructive">{chosenDevice.name} is a browser with no printer bridge. The printer can be saved against it, but nothing will print until the FRYBIRD POS app runs on that device.</p>}

      <div className="grid gap-1.5">
        <span className="text-sm font-semibold">Connection</span>
        <div role="radiogroup" aria-label="Connection" className="grid grid-cols-3 gap-2">
          {(
            [
              { value: "LAN", label: "Wi-Fi / LAN", supported: true, note: null },
              { value: "BLUETOOTH", label: "Bluetooth", supported: bluetoothAvailable || form.connectionType === "BLUETOOTH", note: bluetoothAvailable ? null : hasBridge ? "no Bluetooth radio" : "needs FRYBIRD POS app" },
              { value: "USB", label: "USB", supported: usbAvailable, note: usbAvailable ? null : hasBridge ? "not in this app version" : "needs FRYBIRD POS app" },
            ] as const
          ).map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={form.connectionType === option.value} disabled={!option.supported} onClick={() => set("connectionType", option.value)} className={cn("min-h-[44px] rounded-md border px-2 text-sm font-medium", form.connectionType === option.value ? "border-foreground bg-surface" : "border-border text-muted-foreground", !option.supported && "cursor-not-allowed opacity-50")}>
              {option.label}
              {option.note && <span className="block text-[10px] font-normal">{option.note}</span>}
            </button>
          ))}
        </div>
      </div>

      {form.connectionType === "BLUETOOTH" && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Bluetooth className="size-4" aria-hidden="true" />
              Bluetooth Printer
            </span>
            {thisIsTheDevice && bluetooth?.enabled && bluetooth.permission !== "denied" && (
              <Button type="button" variant="outline" size="sm" onClick={scanBluetooth} disabled={btBusy !== null}>
                {btBusy === "scan" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                {btBusy === "scan" ? "Scanning…" : "Scan for Printers"}
              </Button>
            )}
          </div>

          {!thisIsTheDevice && <p className="text-xs text-muted-foreground">Scan and connect from {chosenDevice?.name ?? "the POS device"} — the device that holds the Bluetooth link.</p>}
          {thisIsTheDevice && !bluetooth && <p className="text-xs text-muted-foreground">Checking Bluetooth…</p>}
          {thisIsTheDevice && bluetooth && !bluetooth.supported && <p className="text-xs text-destructive">This device has no Bluetooth radio.</p>}
          {thisIsTheDevice && bluetooth?.supported && !bluetooth.enabled && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2">
              <span className="text-sm font-medium">Bluetooth is turned off.</span>
              <Button type="button" size="sm" onClick={enableBluetooth} disabled={btBusy !== null}>
                {btBusy === "enable" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Bluetooth aria-hidden="true" />}
                Turn On Bluetooth
              </Button>
            </div>
          )}
          {thisIsTheDevice && bluetooth?.supported && bluetooth.enabled && bluetooth.permission === "denied" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2">
              <span className="text-sm">Bluetooth permission was denied. Allow &ldquo;Nearby devices&rdquo; for FRYBIRD POS.</span>
              <Button type="button" size="sm" onClick={enableBluetooth} disabled={btBusy !== null}>
                Allow Bluetooth access
              </Button>
            </div>
          )}

          {btDevices && btDevices.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Available Devices</span>
              <ul className="flex flex-col gap-1">
                {btDevices.map((candidate) => {
                  const selected = form.bluetoothAddress === candidate.address;
                  return (
                    <li key={candidate.address} className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{candidate.name ?? "Unnamed device"}</span>
                        <span className="tabular text-xs text-muted-foreground">
                          {candidate.address}
                          {candidate.paired ? " · paired" : " · not paired yet — Android will ask to pair (POSIFLOW PIN is usually 0000)"}
                        </span>
                      </span>
                      <Button type="button" size="sm" variant={selected ? "default" : "outline"} disabled={btBusy !== null} onClick={() => connectBluetooth(candidate)}>
                        {btBusy === "connect" && selected ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                        {selected && btStatus?.status === "ONLINE" ? "Connected" : "Connect"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {connection && (
            <div className="rounded border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-heading text-base font-semibold">{form.bluetoothName || form.name}</p>
                <StatusDot status={btStatus?.status ?? "UNKNOWN"} label={btStatus?.status === "ONLINE" ? "Connected" : btStatus?.status === "CONNECTING" ? "Connecting…" : btStatus ? "Disconnected" : "Not checked"} className="font-medium" />
              </div>
              <dl className="mt-2 divide-y divide-border/60 text-sm">
                <div className="flex justify-between py-1">
                  <dt className="text-muted-foreground">Connection</dt>
                  <dd className="font-medium">Bluetooth</dd>
                </div>
                <div className="flex justify-between py-1">
                  <dt className="text-muted-foreground">Device address</dt>
                  <dd className="tabular font-medium">{form.bluetoothAddress}</dd>
                </div>
                <div className="flex justify-between py-1">
                  <dt className="text-muted-foreground">Paper</dt>
                  <dd className="font-medium">{form.paperWidthMm} mm</dd>
                </div>
                <div className="flex justify-between py-1">
                  <dt className="text-muted-foreground">Protocol</dt>
                  <dd className="font-medium">{form.protocol}</dd>
                </div>
              </dl>
              {btStatus?.error && btStatus.status !== "ONLINE" && <p className="mt-1 text-xs text-destructive">{btStatus.error}</p>}
              {thisIsTheDevice && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={testBluetoothConnection} disabled={btBusy !== null}>
                    {btBusy === "test" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Test Connection
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={testBluetoothPrint} disabled={btBusy !== null}>
                    {btBusy === "print" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Printer aria-hidden="true" />}
                    Test Print
                  </Button>
                </div>
              )}
            </div>
          )}
          {btNote && (
            <p role={btNote.tone === "error" ? "alert" : "status"} className={cn("text-xs", btNote.tone === "error" ? "text-destructive" : "text-success")}>
              {btNote.text}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pf-name" label="Printer name">
          <input id="pf-name" value={form.name} onChange={(event) => set("name", event.target.value)} className={inputClass} required maxLength={80} />
        </Field>
        <Field id="pf-model" label="Printer model">
          <input id="pf-model" value={form.model} onChange={(event) => set("model", event.target.value)} className={inputClass} maxLength={80} />
        </Field>
      </div>

      {form.connectionType === "LAN" && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">Printer address</span>
            {thisIsTheDevice ? (
              <Button type="button" variant="outline" size="sm" onClick={discoverLan} disabled={discovering}>
                {discovering ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                {discovering ? "Scanning this network…" : "Find printers on this network"}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">To scan for it, open this page in FRYBIRD POS on {chosenDevice?.name ?? "the POS device"}. Or enter the IP below.</span>
            )}
          </div>
          {found && found.length > 0 && (
            <ul className="flex flex-col gap-1">
              {found.flatMap((candidate) =>
                candidate.transport !== "LAN"
                  ? []
                  : [
                      <li key={candidate.host} className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-sm">
                        <span className="inline-flex items-center gap-2">
                          <Wifi className="size-4 text-muted-foreground" aria-hidden="true" />
                          <span className="tabular font-medium">{candidate.host}</span>
                          <span className="text-xs text-muted-foreground">
                            port {candidate.port}
                            {candidate.latencyMs !== null ? ` · ${candidate.latencyMs} ms` : ""}
                          </span>
                        </span>
                        <Button type="button" size="sm" variant={form.ipAddress === candidate.host ? "default" : "outline"} onClick={() => setForm((current) => ({ ...current, ipAddress: candidate.host, port: String(candidate.port) }))}>
                          {form.ipAddress === candidate.host ? "Selected" : "Use"}
                        </Button>
                      </li>,
                    ],
              )}
            </ul>
          )}
          {discoverNote && <p className="text-xs text-muted-foreground">{discoverNote}</p>}
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field id="pf-ip" label="IP address" hint="Enter IP manually — from the printer's self-test page or your router's device list. Private addresses only.">
              <input id="pf-ip" value={form.ipAddress} onChange={(event) => set("ipAddress", event.target.value)} className={cn(inputClass, "tabular")} inputMode="decimal" placeholder="192.168.x.x" autoComplete="off" />
            </Field>
            <Field id="pf-port" label="Port">
              <input id="pf-port" value={form.port} onChange={(event) => set("port", event.target.value)} className={cn(inputClass, "tabular")} inputMode="numeric" />
            </Field>
          </div>
          {form.ipAddress && !address.ok && <p className="text-xs text-destructive">{address.message}</p>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="pf-paper" label="Paper width">
          <select id="pf-paper" value={form.paperWidthMm} onChange={(event) => set("paperWidthMm", event.target.value as "80" | "58")} className={selectClass}>
            <option value="80">80 mm (576 dots)</option>
            <option value="58">58 mm (384 dots)</option>
          </select>
        </Field>
        <Field id="pf-protocol" label="Protocol">
          <input id="pf-protocol" value={form.protocol} onChange={(event) => set("protocol", event.target.value)} className={inputClass} />
        </Field>
        <Field id="pf-mac" label="Wi-Fi MAC (optional)" hint="Printed on the label, e.g. 24:19:7B:5B:A6:FE">
          <input id="pf-mac" value={form.macAddress} onChange={(event) => set("macAddress", event.target.value)} className={cn(inputClass, "tabular uppercase")} placeholder="24:19:7B:5B:A6:FE" autoComplete="off" />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor="pf-default" className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 text-sm">
          <input id="pf-default" type="checkbox" checked={form.isDefault} onChange={(event) => set("isDefault", event.target.checked)} className="size-4 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">Default Printer</span>
            <span className="block text-xs text-muted-foreground">The one this device prints receipts to</span>
          </span>
        </label>
        <label htmlFor="pf-auto" className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 text-sm">
          <input id="pf-auto" type="checkbox" checked={form.autoPrintEnabled} onChange={(event) => set("autoPrintEnabled", event.target.checked)} className="size-4 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">Auto Print</span>
            <span className="block text-xs text-muted-foreground">Print the receipt as soon as payment is taken</span>
          </span>
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending || devices.length === 0}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {printer ? "Save printer" : "Add printer"}
        </Button>
      </div>
    </form>
  );
}

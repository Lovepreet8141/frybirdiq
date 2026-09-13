"use client";

/**
 * Add / edit a printer. Wi-Fi / LAN is the connection the FRYBIRD POS
 * bridge speaks today; Bluetooth and USB are listed and honestly marked
 * as not yet supported rather than pretending. "Find printers" runs on
 * the device that will print — never from the cloud, never off the LAN —
 * and "Enter IP manually" is always there.
 */

import { useState, useTransition } from "react";
import { Loader2, Search, Wifi } from "lucide-react";
import { Field, inputClass, selectClass } from "@/components/inventory/field";
import { Button } from "@/components/ui/button";
import { savePrinterAction } from "@/lib/hardware/actions";
import { validatePrinterAddress } from "@/lib/hardware/net";
import type { DiscoveredPrinter, PrinterConnectionType } from "@/lib/hardware/printer/types";
import type { DeviceRecord, PrinterRecord } from "@/lib/repositories/hardware";
import { cn } from "@/lib/utils";
import { useLocalPrinter } from "./device-agent";

export const POSIFLOW = { model: "POSIFLOW KPC307-UEWB", manufacturer: "POSIFLOW", port: 9100, paperWidthMm: 80 as const, protocol: "ESC/POS" };

interface FormState {
  deviceId: string;
  name: string;
  model: string;
  manufacturer: string;
  connectionType: PrinterConnectionType;
  ipAddress: string;
  port: string;
  macAddress: string;
  paperWidthMm: "80" | "58";
  protocol: string;
  isDefault: boolean;
  autoPrintEnabled: boolean;
}

function initial(printer: PrinterRecord | null, devices: readonly DeviceRecord[], thisDeviceId: string | null, firstPrinter: boolean): FormState {
  return {
    deviceId: printer?.deviceId ?? thisDeviceId ?? devices[0]?.id ?? "",
    name: printer?.name ?? "Receipt Printer",
    model: printer?.model ?? POSIFLOW.model,
    manufacturer: printer?.manufacturer ?? POSIFLOW.manufacturer,
    connectionType: printer?.connectionType ?? "LAN",
    ipAddress: printer?.ipAddress ?? "",
    port: String(printer?.port ?? POSIFLOW.port),
    macAddress: printer?.macAddress ?? "",
    paperWidthMm: printer?.paperWidthMm === 58 ? "58" : "80",
    protocol: printer?.protocol ?? POSIFLOW.protocol,
    isDefault: printer?.isDefault ?? firstPrinter,
    autoPrintEnabled: printer?.autoPrintEnabled ?? true,
  };
}

export function PrinterForm({ printer, devices, firstPrinter, onSaved, onCancel }: { printer: PrinterRecord | null; devices: readonly DeviceRecord[]; firstPrinter: boolean; onSaved: (printer: PrinterRecord) => void; onCancel: () => void }) {
  const local = useLocalPrinter();
  const [form, setForm] = useState<FormState>(() => initial(printer, devices, local?.device?.id ?? null, firstPrinter));
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<readonly DiscoveredPrinter[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverNote, setDiscoverNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const chosenDevice = devices.find((device) => device.id === form.deviceId) ?? null;
  const thisIsTheDevice = Boolean(local?.client.supported && local.device && local.device.id === form.deviceId);
  const address = validatePrinterAddress(form.ipAddress, Number(form.port));

  async function discover() {
    if (!local?.client.supported) return;
    setDiscovering(true);
    setDiscoverNote(null);
    try {
      const printers = await local.client.discover({ timeoutMs: 15_000 });
      setFound(printers);
      setDiscoverNote(printers.length === 0 ? "Nothing answered on port 9100. Check the printer is on and on the same Wi-Fi, or enter its IP from the printer's self-test page." : null);
    } catch (caught) {
      setFound([]);
      setDiscoverNote(caught instanceof Error ? caught.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="border-l-2 border-[var(--destructive)] bg-surface px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <Field id="pf-device" label="Device" hint="The POS device standing next to this printer. Only that device's local bridge will ever talk to it.">
        <select id="pf-device" value={form.deviceId} onChange={(event) => set("deviceId", event.target.value)} className={selectClass} required>
          {devices.length === 0 && <option value="">No registered devices yet</option>}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
              {device.capabilities.localPrinterBridge ? "" : " (no printer bridge)"}
            </option>
          ))}
        </select>
      </Field>
      {chosenDevice && !chosenDevice.capabilities.localPrinterBridge && <p className="text-xs text-muted-foreground">{chosenDevice.name} is a plain browser. It can hold this configuration, but it cannot print to a thermal printer — install the FRYBIRD POS app on the device at the counter.</p>}

      <div className="grid gap-1.5">
        <span className="text-sm font-semibold">Connection</span>
        <div role="radiogroup" aria-label="Connection" className="grid grid-cols-3 gap-2">
          {(
            [
              { value: "LAN", label: "Wi-Fi / LAN", supported: true },
              { value: "BLUETOOTH", label: "Bluetooth", supported: false },
              { value: "USB", label: "USB", supported: false },
            ] as const
          ).map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={form.connectionType === option.value} disabled={!option.supported} onClick={() => set("connectionType", option.value)} className={cn("min-h-[44px] rounded-md border px-2 text-sm font-medium", form.connectionType === option.value ? "border-foreground bg-surface" : "border-border text-muted-foreground", !option.supported && "cursor-not-allowed opacity-50")}>
              {option.label}
              {!option.supported && <span className="block text-[10px] font-normal">not yet</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pf-name" label="Printer name">
          <input id="pf-name" value={form.name} onChange={(event) => set("name", event.target.value)} className={inputClass} required maxLength={80} />
        </Field>
        <Field id="pf-model" label="Printer model">
          <input id="pf-model" value={form.model} onChange={(event) => set("model", event.target.value)} className={inputClass} maxLength={80} />
        </Field>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">Printer address</span>
          {thisIsTheDevice ? (
            <Button type="button" variant="outline" size="sm" onClick={discover} disabled={discovering}>
              {discovering ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
              {discovering ? "Scanning this network…" : "Find printers on this network"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">To scan for it, open this page on {chosenDevice?.name ?? "the POS device"}. Or enter the IP below.</span>
          )}
        </div>
        {found && found.length > 0 && (
          <ul className="flex flex-col gap-1">
            {found.map((candidate) => (
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
              </li>
            ))}
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
            <span className="font-medium">Default printer</span>
            <span className="block text-xs text-muted-foreground">The one this device prints receipts to</span>
          </span>
        </label>
        <label htmlFor="pf-auto" className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 text-sm">
          <input id="pf-auto" type="checkbox" checked={form.autoPrintEnabled} onChange={(event) => set("autoPrintEnabled", event.target.checked)} className="size-4 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">Auto print</span>
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

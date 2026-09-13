"use client";

/**
 * Settings › Hardware › Printers.
 *
 * Three things, all real: this device (what it is and whether it has a
 * printer bridge), the store's registered devices with when they were
 * last heard from, and the store's printers with the status the bound
 * device last reported. The buttons that need the LAN — Test
 * connection, Test print, Reconnect, Find printers — light up only on
 * the device that owns the printer; from anywhere else they say so.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Printer, RefreshCw, Smartphone, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deletePrinterAction, removeDeviceAction, renameDeviceAction } from "@/lib/hardware/actions";
import { isOnline } from "@/lib/hardware/device";
import type { DeviceRecord, PrintJobRecord, PrinterRecord } from "@/lib/repositories/hardware";
import { cn } from "@/lib/utils";
import { useLocalPrinter } from "./device-agent";
import { PrinterForm } from "./printer-form";
import { STATUS_LABEL, StatusDot } from "./printer-status";
import { relativeTime } from "./relative-time";

type Notice = { tone: "ok" | "error"; text: string } | null;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export function HardwarePage({ devices, printers, jobs, shopName, canManage }: { devices: readonly DeviceRecord[]; printers: readonly PrinterRecord[]; jobs: readonly PrintJobRecord[]; shopName: string; canManage: boolean }) {
  const local = useLocalPrinter();
  const router = useRouter();
  const now = useNow();
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<PrinterRecord | null | "new">(null);
  const [confirmDelete, setConfirmDelete] = useState<PrinterRecord | null>(null);
  const [confirmRemoveDevice, setConfirmRemoveDevice] = useState<DeviceRecord | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const bridge = Boolean(local?.client.supported);
  const thisDeviceId = local?.device?.id ?? null;
  const ownsPrinter = (printer: PrinterRecord) => bridge && thisDeviceId !== null && printer.deviceId === thisDeviceId;

  async function run(key: string, work: () => Promise<Notice>) {
    setBusy(key);
    setNotice(null);
    try {
      setNotice(await work());
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const testConnection = (printer: PrinterRecord) =>
    run(`conn-${printer.id}`, async () => {
      if (!local || !printer.ipAddress) return { tone: "error", text: "This printer has no address." };
      const result = await local.testConnection({ connectionType: printer.connectionType, host: printer.ipAddress, port: printer.port });
      await local.refreshStatus();
      return result.ok ? { tone: "ok", text: `${printer.name} answered on port ${printer.port}${result.latencyMs !== null ? ` in ${result.latencyMs} ms` : ""}.` } : { tone: "error", text: result.error ?? `${printer.name} did not answer.` };
    });

  const testPrint = (printer: PrinterRecord) =>
    run(`print-${printer.id}`, async () => {
      if (!local) return { tone: "error", text: "No printer bridge on this device." };
      const result = await local.testPrint(printer, shopName);
      return result.ok ? { tone: "ok", text: `Test print sent to ${printer.name}.` } : { tone: "error", text: result.error };
    });

  const reconnect = (printer: PrinterRecord) =>
    run(`reconnect-${printer.id}`, async () => {
      if (!local) return { tone: "error", text: "No printer bridge on this device." };
      const status = await local.reconnect();
      return status === "ONLINE" ? { tone: "ok", text: `${printer.name} is online.` } : { tone: "error", text: `${printer.name}: ${STATUS_LABEL[status].toLowerCase()}${local.statusError ? ` — ${local.statusError}` : ""}.` };
    });

  function deletePrinter(printer: PrinterRecord) {
    setConfirmDelete(null);
    startTransition(async () => {
      const result = await deletePrinterAction(printer.id);
      setNotice(result.ok ? { tone: "ok", text: `${printer.name} removed.` } : { tone: "error", text: result.error });
      if (result.ok && local?.printer?.id === printer.id) local.setPrinter(null);
      router.refresh();
    });
  }

  function removeDevice(device: DeviceRecord) {
    setConfirmRemoveDevice(null);
    startTransition(async () => {
      const result = await removeDeviceAction(device.id);
      setNotice(result.ok ? { tone: "ok", text: `${device.name} removed, with its printers.` } : { tone: "error", text: result.error });
      router.refresh();
    });
  }

  function saveRename() {
    if (!renaming) return;
    const { id, name } = renaming;
    startTransition(async () => {
      const result = await renameDeviceAction(id, name);
      setNotice(result.ok ? { tone: "ok", text: "Device renamed." } : { tone: "error", text: result.error });
      setRenaming(null);
      router.refresh();
    });
  }

  const thisPrinter = local?.printer ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-[var(--gutter)] py-8">
      <PageHeader
        title="Printers"
        description="Manage printers connected to this store. Receipts print from the POS device standing next to the printer, over the shop's own Wi-Fi — never from the cloud."
        actions={
          canManage ? (
            <Button type="button" size="lg" onClick={() => setEditing("new")} disabled={devices.length === 0}>
              <Plus aria-hidden="true" />
              Add Printer
            </Button>
          ) : null
        }
      />

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={cn("border-l-2 bg-surface px-4 py-3 text-sm", notice.tone === "error" ? "border-[var(--destructive)]" : "border-[var(--success)]")}>
          {notice.text}
        </p>
      )}

      {/* THIS DEVICE */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">This device</h2>
        {!local?.ready ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-4 text-sm text-muted-foreground">Checking this device…</p>
        ) : bridge ? (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="font-heading text-base font-semibold">POS Device Setup</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              <li className="inline-flex items-center gap-2">
                {local.device ? <Check className="size-4 text-success" aria-hidden="true" /> : <X className="size-4 text-destructive" aria-hidden="true" />}
                {local.device ? `Device registered as ${local.device.name}` : "Device not registered"}
              </li>
              <li className="inline-flex items-center gap-2">
                <Check className="size-4 text-success" aria-hidden="true" />
                Printer bridge ready{local.bridge ? ` · bridge ${local.bridge.bridgeVersion} · app ${local.bridge.appVersion}` : ""}
              </li>
            </ul>
            <dl className="mt-3 border-t border-border pt-3">
              <Row label="Printer">{thisPrinter ? `${thisPrinter.name}${thisPrinter.model ? ` · ${thisPrinter.model}` : ""}` : "None configured for this device"}</Row>
              {thisPrinter && (
                <Row label="Status">
                  <StatusDot status={local.status} />
                </Row>
              )}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {!local.device && (
                <Button type="button" onClick={() => run("register", async () => ((await local.register()).ok ? { tone: "ok", text: "This device is registered." } : { tone: "error", text: "Could not register this device." }))} disabled={busy === "register"}>
                  Register this device
                </Button>
              )}
              {local.device && canManage && (
                <Button type="button" variant={thisPrinter ? "outline" : "default"} onClick={() => setEditing(thisPrinter ?? "new")}>
                  <Printer aria-hidden="true" />
                  {thisPrinter ? "Configure Printer" : "Set up printing"}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm">This device can run FRYBIRD POS, but direct thermal printing is not configured. Direct thermal printing is available on a configured POS device — the FRYBIRD POS app on the Android tablet at the counter.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {local.identity ? `Detected: ${local.identity.name} · ${local.identity.platform.toLowerCase()} · no printer bridge.` : "This browser has no storage for a device key."}
              {local.device ? ` Registered as ${local.device.name}.` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!local.device && local.identity && (
                <Button type="button" variant="outline" onClick={() => run("register", async () => ((await local.register()).ok ? { tone: "ok", text: "This browser is registered as a device. It still cannot print to a thermal printer." } : { tone: "error", text: "Could not register this device." }))} disabled={busy === "register"}>
                  Register this browser as a device
                </Button>
              )}
              <a href="#setup" className="inline-flex min-h-[32px] items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
                Set Up Printing
              </a>
            </div>
          </div>
        )}
      </section>

      {/* DEVICES */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Devices</h2>
          <p className="text-sm text-muted-foreground">Only devices that registered themselves appear here. Online means heard from in the last three minutes.</p>
        </div>
        {devices.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No device has registered yet. Open FRYBIRD POS on the tablet at the counter and it will appear here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {devices.map((device) => {
              const online = isOnline(device.lastSeenAt, now);
              return (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Smartphone className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      {renaming?.id === device.id ? (
                        <span className="flex items-center gap-1">
                          <input value={renaming.name} onChange={(event) => setRenaming({ id: device.id, name: event.target.value })} onKeyDown={(event) => event.key === "Enter" && saveRename()} className="h-[36px] rounded-md border border-border bg-background px-2 text-sm" aria-label="Device name" autoFocus />
                          <Button type="button" size="icon-xs" variant="ghost" aria-label="Save name" onClick={saveRename} disabled={isPending}>
                            <Check aria-hidden="true" />
                          </Button>
                          <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel" onClick={() => setRenaming(null)}>
                            <X aria-hidden="true" />
                          </Button>
                        </span>
                      ) : (
                        <p className="flex items-center gap-2 font-semibold">
                          <StatusDot status={online ? "ONLINE" : "OFFLINE"} label={device.name} />
                          {device.id === thisDeviceId && <span className="rounded bg-muted px-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">This device</span>}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {online ? "Online" : "Offline"} · {device.platform.charAt(0) + device.platform.slice(1).toLowerCase()} {device.deviceType.toLowerCase().replace("_", " ")} · Last seen: {relativeTime(device.lastSeenAt, now)}
                        {device.capabilities.localPrinterBridge ? ` · bridge ${device.bridgeVersion ?? "?"}` : " · no printer bridge"}
                        {device.lastPrinterStatus ? ` · printer ${STATUS_LABEL[device.lastPrinterStatus].toLowerCase()}` : ""}
                      </p>
                    </div>
                  </div>
                  {canManage && (
                    <span className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming({ id: device.id, name: device.name })}>
                        <Pencil aria-hidden="true" />
                        Rename
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmRemoveDevice(device)}>
                        <Trash2 aria-hidden="true" />
                        Remove
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* PRINTERS */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Printers</h2>
        {printers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No printer yet. {devices.length === 0 ? "Register the POS device first, then add the printer." : canManage ? "Add the POSIFLOW from the device next to it, or from here with its IP." : "An owner or admin can add one."}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {printers.map((printer) => {
              const mine = ownsPrinter(printer);
              const liveStatus = mine ? (local?.status ?? printer.lastStatus) : printer.lastStatus;
              const deviceOnline = isOnline(devices.find((device) => device.id === printer.deviceId)?.lastSeenAt ?? null, now);
              return (
                <li key={printer.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-heading text-base font-semibold">{printer.name}</p>
                      <p className="text-sm text-muted-foreground">{printer.model ?? printer.protocol}</p>
                    </div>
                    <StatusDot status={liveStatus} label={liveStatus === "ONLINE" ? "Online" : liveStatus === "OFFLINE" ? "Offline" : STATUS_LABEL[liveStatus]} className="font-medium" />
                  </div>
                  <dl className="divide-y divide-border/60">
                    <Row label="Device">
                      {printer.deviceName}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">({deviceOnline ? "online" : "offline"})</span>
                    </Row>
                    <Row label="Connection">{printer.connectionType === "LAN" ? "Wi-Fi / LAN" : printer.connectionType}</Row>
                    <Row label="IP">
                      <span className="tabular">{printer.ipAddress ?? "—"}</span>
                    </Row>
                    <Row label="Port">
                      <span className="tabular">{printer.port}</span>
                    </Row>
                    <Row label="Paper">{printer.paperWidthMm} mm</Row>
                    <Row label="Auto Print">{printer.autoPrintEnabled ? "ON" : "OFF"}</Row>
                    <Row label="Default">{printer.isDefault ? "YES" : "NO"}</Row>
                    <Row label="Last Print">{relativeTime(printer.lastSuccessfulPrintAt, now)}</Row>
                    {printer.lastError && liveStatus !== "ONLINE" && <Row label="Last error">{printer.lastError}</Row>}
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={!mine || busy !== null} onClick={() => testConnection(printer)} title={mine ? undefined : `Run from ${printer.deviceName}`}>
                      {busy === `conn-${printer.id}` ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                      Test connection
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={!mine || busy !== null} onClick={() => testPrint(printer)} title={mine ? undefined : `Run from ${printer.deviceName}`}>
                      {busy === `print-${printer.id}` ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Printer aria-hidden="true" />}
                      Test Print
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={!mine || busy !== null} onClick={() => reconnect(printer)} title={mine ? undefined : `Run from ${printer.deviceName}`}>
                      {busy === `reconnect-${printer.id}` ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                      Reconnect
                    </Button>
                    {canManage && (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(printer)}>
                          <Pencil aria-hidden="true" />
                          Edit
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(printer)}>
                          <Trash2 aria-hidden="true" />
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                  {!mine && <p className="text-xs text-muted-foreground">Test, print and reconnect run on {printer.deviceName}, the device connected to this printer. From here you can edit its configuration.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* RECENT PRINT JOBS */}
      {jobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Recent print jobs</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  <span className="font-medium">{job.kind === "TEST" ? "Test print" : job.kind === "DUPLICATE" ? "Duplicate receipt" : "Receipt"}</span>
                  <span className="text-muted-foreground"> · {printers.find((printer) => printer.id === job.printerId)?.name ?? "removed printer"}</span>
                </span>
                <span className="inline-flex items-center gap-3 text-xs text-muted-foreground">
                  <span className={cn("font-semibold", job.status === "PRINTED" ? "text-success" : job.status === "FAILED" ? "text-destructive" : "")}>{job.status.charAt(0) + job.status.slice(1).toLowerCase()}</span>
                  <span>
                    {job.attempts} attempt{job.attempts === 1 ? "" : "s"}
                  </span>
                  <span>{relativeTime(job.printedAt ?? job.createdAt, now)}</span>
                  {job.error && <span className="text-destructive">{job.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* SETUP GUIDE */}
      <section id="setup" className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Set up printing at the counter</h2>
        <ol className="list-decimal space-y-1 rounded-lg border border-border bg-surface px-8 py-4 text-sm">
          <li>Install and open the FRYBIRD POS Android app on the tablet at the counter and sign in. The device registers itself and appears under Devices.</li>
          <li>On that tablet, open Settings → Hardware → Printers and tap Add Printer.</li>
          <li>Tap Find printers on this network, or enter the POSIFLOW&rsquo;s IP from its self-test page. Port 9100, ESC/POS, 80 mm are already filled in.</li>
          <li>Test connection, then Test Print. Keep Default and Auto print on.</li>
          <li>From then on every paid order prints its receipt automatically. If the printer is off, the order still completes and the receipt can be retried.</li>
        </ol>
      </section>

      {/* DIALOGS */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" || editing === null ? "Add printer" : `Edit ${editing.name}`}</DialogTitle>
            <DialogDescription>Wi-Fi / LAN printers print over the shop&rsquo;s own network from the device you choose.</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <PrinterForm
              printer={editing === "new" ? null : editing}
              devices={devices}
              firstPrinter={printers.length === 0}
              onCancel={() => setEditing(null)}
              onSaved={(saved) => {
                setEditing(null);
                setNotice({ tone: "ok", text: `${saved.name} saved. ${saved.deviceName} will use it${saved.autoPrintEnabled ? " and print automatically after payment" : ""}.` });
                if (local?.device && saved.deviceId === local.device.id) local.setPrinter(saved);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>{confirmDelete?.deviceName} will stop printing receipts until a printer is added again. Print history is kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => confirmDelete && deletePrinter(confirmDelete)} disabled={isPending}>
              Remove printer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemoveDevice !== null} onOpenChange={(open) => !open && setConfirmRemoveDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirmRemoveDevice?.name}?</DialogTitle>
            <DialogDescription>Its printers are removed with it. The device will register again the next time FRYBIRD POS opens on it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRemoveDevice(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => confirmRemoveDevice && removeDevice(confirmRemoveDevice)} disabled={isPending}>
              Remove device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

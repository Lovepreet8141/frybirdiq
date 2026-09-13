/**
 * Address rules for a printer on the shop's own network. Pure; tested.
 *
 * A printer address is only ever a private LAN address — the bridge on the
 * device at the counter is the only thing that connects to it, and it
 * refuses anything routable on the internet. The same rule is enforced on
 * the server when a printer is saved, in the shim before a request leaves
 * the page, and again natively before a socket opens.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIPv4(value: string): readonly [number, number, number, number] | null {
  const match = IPV4.exec(value.trim());
  if (!match) return null;
  const parts = match.slice(1, 5).map(Number) as [number, number, number, number];
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

/** RFC 1918 and link-local — the only addresses a printer may have. */
export function isPrivateIPv4(value: string): boolean {
  const ip = parseIPv4(value);
  if (!ip) return false;
  const [a, b] = ip;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

const MAC = /^([0-9A-F]{2})(:[0-9A-F]{2}){5}$/;

/** "24:19:7b:5b:a6:fe" → "24:19:7B:5B:A6:FE"; null when it is not a MAC. */
export function normaliseMac(value: string): string | null {
  const cleaned = value.trim().toUpperCase().replace(/-/g, ":");
  return MAC.test(cleaned) ? cleaned : null;
}

export type AddressError = "EMPTY" | "NOT_AN_IP" | "NOT_PRIVATE" | "BAD_PORT";

export function validatePrinterAddress(host: string, port: number): { ok: true; host: string; port: number } | { ok: false; error: AddressError; message: string } {
  const trimmed = host.trim();
  if (!trimmed) return { ok: false, error: "EMPTY", message: "Enter the printer's IP address." };
  if (!parseIPv4(trimmed)) return { ok: false, error: "NOT_AN_IP", message: "That is not an IPv4 address, like 192.168.1.50." };
  if (!isPrivateIPv4(trimmed)) return { ok: false, error: "NOT_PRIVATE", message: "A printer must be on the shop's own network (192.168.x.x, 10.x.x.x or 172.16–31.x.x)." };
  if (!isValidPort(port)) return { ok: false, error: "BAD_PORT", message: "Port must be between 1 and 65535 — 9100 for ESC/POS over LAN." };
  return { ok: true, host: trimmed, port };
}

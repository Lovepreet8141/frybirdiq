/**
 * Who am I? — the device's own view of itself. Pure functions over the
 * facts a browser or bridge exposes, so they can be tested without one.
 */

import type { BridgeCapabilities, DevicePlatform, DeviceType, HardwareCapabilities } from "./printer/types";
import { NO_HARDWARE } from "./printer/types";

export interface DeviceIdentity {
  readonly deviceKey: string;
  readonly name: string;
  readonly deviceType: DeviceType;
  readonly platform: DevicePlatform;
  readonly appVersion: string | null;
  readonly bridgeVersion: string | null;
  readonly capabilities: HardwareCapabilities;
}

export function detectPlatform(userAgent: string): DevicePlatform {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android")) return "ANDROID";
  if (/iphone|ipad|ipod/.test(ua) || (ua.includes("macintosh") && ua.includes("mobile"))) return "IOS";
  if (ua.includes("windows")) return "WINDOWS";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "MACOS";
  if (ua.includes("linux") || ua.includes("cros")) return "LINUX";
  return "WEB";
}

export function detectDeviceType(userAgent: string, viewportWidth: number): DeviceType {
  const ua = userAgent.toLowerCase();
  const mobile = /android|iphone|ipad|ipod|mobile/.test(ua);
  if (!mobile) return "DESKTOP";
  return viewportWidth >= 700 || ua.includes("ipad") || (ua.includes("android") && !ua.includes("mobile")) ? "TABLET" : "PHONE";
}

/** A readable default name: "Xiaomi Redmi Pad", "Chrome on macOS". */
export function defaultDeviceName(platform: DevicePlatform, userAgent: string, bridge: BridgeCapabilities | null): string {
  if (bridge) return [bridge.manufacturer, bridge.model].filter(Boolean).join(" ") || bridge.deviceName || "POS device";
  const ua = userAgent;
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome\//i.test(ua) ? "Chrome" : /firefox\//i.test(ua) ? "Firefox" : /safari\//i.test(ua) ? "Safari" : "Browser";
  const os = platform === "MACOS" ? "macOS" : platform === "WINDOWS" ? "Windows" : platform === "LINUX" ? "Linux" : platform === "IOS" ? "iOS" : platform === "ANDROID" ? "Android" : "the web";
  return `${browser} on ${os}`;
}

/**
 * The device as it will register. With a native bridge the bridge's own
 * facts win (its device id, model, versions, real capabilities); without
 * one, the browser is exactly what it is — a browser with no printer.
 */
export function describeDevice(input: { deviceKey: string; userAgent: string; viewportWidth: number; appVersion: string | null; bridge: BridgeCapabilities | null }): DeviceIdentity {
  const { bridge } = input;
  const platform = bridge?.platform ?? detectPlatform(input.userAgent);
  return {
    deviceKey: bridge?.deviceId ?? input.deviceKey,
    name: defaultDeviceName(platform, input.userAgent, bridge),
    deviceType: bridge?.deviceType ?? detectDeviceType(input.userAgent, input.viewportWidth),
    platform,
    appVersion: bridge?.appVersion ?? input.appVersion,
    bridgeVersion: bridge?.bridgeVersion ?? null,
    capabilities: bridge ? bridge.capabilities : NO_HARDWARE,
  };
}

export const DEVICE_KEY_STORAGE = "frybird.device.key";

/** The device's own key, minted once and kept in its storage. Null where storage is unavailable. */
export function loadOrMintDeviceKey(storage: Pick<Storage, "getItem" | "setItem"> | null, mint: () => string): string | null {
  if (!storage) return null;
  try {
    const existing = storage.getItem(DEVICE_KEY_STORAGE);
    if (existing && existing.length >= 16) return existing;
    const fresh = mint();
    storage.setItem(DEVICE_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/** Seen within this many milliseconds counts as online. Heartbeats are a minute apart. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export function isOnline(lastSeenAt: Date | string | null, now: number): boolean {
  if (!lastSeenAt || now === 0) return false;
  const seen = typeof lastSeenAt === "string" ? Date.parse(lastSeenAt) : lastSeenAt.getTime();
  return now - seen <= ONLINE_WINDOW_MS;
}

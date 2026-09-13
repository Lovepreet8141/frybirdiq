import { describe, expect, it } from "vitest";
import { describeDevice, detectDeviceType, detectPlatform, isOnline, loadOrMintDeviceKey } from "./device";
import { isPrivateIPv4, normaliseMac, validatePrinterAddress } from "./net";

describe("printer addresses", () => {
  it("accepts only private LAN addresses", () => {
    expect(isPrivateIPv4("192.168.1.105")).toBe(true);
    expect(isPrivateIPv4("10.0.0.7")).toBe(true);
    expect(isPrivateIPv4("172.16.4.2")).toBe(true);
    expect(isPrivateIPv4("172.32.0.1")).toBe(false);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv4("frybirdiq.tech")).toBe(false);
    expect(isPrivateIPv4("192.168.1.256")).toBe(false);
  });

  it("validates host and port together with a reason", () => {
    expect(validatePrinterAddress(" 192.168.1.105 ", 9100)).toEqual({ ok: true, host: "192.168.1.105", port: 9100 });
    expect(validatePrinterAddress("", 9100)).toMatchObject({ ok: false, error: "EMPTY" });
    expect(validatePrinterAddress("1.2.3.4", 9100)).toMatchObject({ ok: false, error: "NOT_PRIVATE" });
    expect(validatePrinterAddress("192.168.1.5", 70000)).toMatchObject({ ok: false, error: "BAD_PORT" });
  });

  it("normalises a MAC", () => {
    expect(normaliseMac("24:19:7b:5b:a6:fe")).toBe("24:19:7B:5B:A6:FE");
    expect(normaliseMac("24-19-7B-5B-A6-FE")).toBe("24:19:7B:5B:A6:FE");
    expect(normaliseMac("nope")).toBeNull();
  });
});

describe("device identity", () => {
  const pad = "Mozilla/5.0 (Linux; Android 13; 22081283G Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Safari/537.36";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  const phone = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

  it("detects platform and type from what the browser says", () => {
    expect(detectPlatform(pad)).toBe("ANDROID");
    expect(detectPlatform(mac)).toBe("MACOS");
    expect(detectDeviceType(pad, 1200)).toBe("TABLET");
    expect(detectDeviceType(phone, 390)).toBe("PHONE");
    expect(detectDeviceType(mac, 1440)).toBe("DESKTOP");
  });

  it("a browser registers as a browser — no printer, no bridge", () => {
    const device = describeDevice({ deviceKey: "k".repeat(20), userAgent: mac, viewportWidth: 1440, appVersion: "0.1.0", bridge: null });
    expect(device).toMatchObject({ platform: "MACOS", deviceType: "DESKTOP", name: "Chrome on macOS", bridgeVersion: null });
    expect(device.capabilities).toEqual({ printer: false, localPrinterBridge: false, wifi: false, bluetooth: false, usb: false });
  });

  it("with a bridge the bridge's facts win", () => {
    const device = describeDevice({
      deviceKey: "browser-key-000000000",
      userAgent: pad,
      viewportWidth: 1200,
      appVersion: "0.1.0",
      bridge: { deviceId: "android-id-1", deviceName: "Redmi Pad", platform: "ANDROID", deviceType: "TABLET", model: "Redmi Pad", manufacturer: "Xiaomi", appVersion: "1.0.0", bridgeVersion: "1", capabilities: { printer: true, localPrinterBridge: true, wifi: true, bluetooth: true, usb: false }, network: { wifiConnected: true, subnet: "192.168.1" } },
    });
    expect(device.deviceKey).toBe("android-id-1");
    expect(device.name).toBe("Xiaomi Redmi Pad");
    expect(device.appVersion).toBe("1.0.0");
    expect(device.capabilities.localPrinterBridge).toBe(true);
  });

  it("mints a device key once and keeps it", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const first = loadOrMintDeviceKey(storage, () => "first-key-1234567890");
    const second = loadOrMintDeviceKey(storage, () => "second-key-1234567890");
    expect(first).toBe("first-key-1234567890");
    expect(second).toBe(first);
    expect(loadOrMintDeviceKey(null, () => "x")).toBeNull();
  });

  it("online means seen within the heartbeat window", () => {
    const now = Date.parse("2026-09-13T10:00:00Z");
    expect(isOnline("2026-09-13T09:59:00Z", now)).toBe(true);
    expect(isOnline("2026-09-13T09:50:00Z", now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});

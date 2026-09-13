# FRYBIRD POS — Android shell

The FRYBIRD web POS (`https://frybirdiq.tech/app/pos`) inside a WebView,
plus the **local printer bridge** that lets the tablet at the counter print
ESC/POS to the POSIFLOW over the restaurant's own Wi-Fi.

```
FRYBIRD CLOUD ──HTTPS──▶ this app (WebView) ──window.FRYPOS.printer──▶ PrinterBridge ──TCP 9100──▶ POSIFLOW KPC307-UEWB
```

The cloud never connects to the printer. The web app feature-detects
`window.FRYPOS.printer`; in a normal browser it is absent and the POS runs
without direct thermal printing.

## What is in here

| File | Purpose |
|---|---|
| `MainActivity.kt` | Loads the POS, installs `FRYPOS_NATIVE` for the FRYBIRD origin only (`WebViewCompat.addWebMessageListener`), keeps other origins out. |
| `PrinterBridge.kt` | The ten allowed operations (`CAPABILITIES`, `STATUS`, `DISCOVER`, `CONNECT`, `DISCONNECT`, `TEST_CONNECTION`, `TEST_PRINT`, `PRINT_RECEIPT`, `LAST_ERROR`, `BT_STATE`), address validation (private IPv4 or a Bluetooth MAC), payload caps, duplicate-job protection. |
| `EscPosTcpPrinter.kt` | TCP connect / write / flush / close with timeouts and retry backoff. |
| `PrinterDiscovery.kt` | Scans the tablet's own /24 for port 9100. Local only. |
| `BluetoothPrinter.kt` | Bluetooth Classic (SPP / RFCOMM) to the printer: runtime permissions, enable prompt, scan (paired + nearby), pairing, one kept-open socket, auto-reconnect with backoff, chunked writes. |

The web side of the protocol lives in `src/lib/hardware/printer/bridge.ts`
(the shim that builds `window.FRYPOS.printer` over `FRYPOS_NATIVE`) and
`src/lib/hardware/printer/escpos.ts` (the ESC/POS builder). The Android
app never interprets receipt bytes; it moves them to the socket.

## Build

Requirements: JDK 17, Android SDK (platform 35, build-tools 35), Gradle 8.9
(the wrapper downloads it).

```bash
cd android
./gradlew assembleDebug          # android/app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # needs a signing config; see below
```

Without the wrapper jar, any Gradle 8.9 works: `gradle assembleDebug`.

### Release signing

Create a keystore once and keep it out of git:

```bash
keytool -genkeypair -v -keystore frybird-pos.keystore -alias frybird -keyalg RSA -keysize 2048 -validity 10000
```

Then add to `~/.gradle/gradle.properties` (never to the repo):

```
FRYBIRD_KEYSTORE=/absolute/path/frybird-pos.keystore
FRYBIRD_KEYSTORE_PASSWORD=…
FRYBIRD_KEY_ALIAS=frybird
FRYBIRD_KEY_PASSWORD=…
```

and a `signingConfigs` block in `app/build.gradle.kts` that reads them. The
debug build is enough to test the bridge on the Redmi Pad.

## Install on the Redmi Pad

1. On the Pad: Settings → About → tap MIUI/HyperOS version 7× → Developer
   options → USB debugging on (or use Wireless debugging).
2. `adb install -r app/build/outputs/apk/debug/app-debug.apk`, or copy the
   APK to the Pad and open it (allow installs from that source).
3. Open **FRYBIRD POS**, sign in. The device registers itself and appears
   under Settings → Hardware → Printers on any FRYBIRD IQ login.

## Bluetooth setup at the counter (POSIFLOW KP307-UEWB)

1. Install and open FRYBIRD POS on the Android device next to the printer; sign in.
2. Turn the printer on. On the tablet, Bluetooth on (the app will ask if it is off).
3. In FRYBIRD IQ: Settings → Hardware → Printers → Add Printer → Connection: **Bluetooth**.
4. Tap **Scan for Printers**. Allow "Nearby devices" when Android asks.
5. Pick **KP307-UEWB** (or the POSIFLOW name it advertises) → **Connect**. If Android asks for a PIN, the printer's usual code is 0000 or 1234.
6. Status shows **Connected**. Keep 80 mm / ESC/POS, Default and Auto print on → **Add printer**.
7. Tap **Test Print** on the printer card. The physical printer prints the test ticket.

The bridge keeps the socket open and reconnects on its own when the printer is switched off and on again. "Disconnected" is reported honestly; a failed job stays retryable from the POS.

## Security model

- The bridge object is injected only for `https://frybirdiq.tech` (the
  origin in `BuildConfig.POS_ORIGIN`). Any other page in the WebView —
  including a redirect — does not get it. The listener re-checks the
  source origin and main-frame on every message.
- No `addJavascriptInterface`. No exposed shell, filesystem or arbitrary
  sockets or devices. The only sockets ever opened are TCP to an address
  that passed the private-IPv4 check on a validated port, and RFCOMM to
  the Bluetooth address the person picked from the scan on this tablet.
- Print payloads are capped at 2 MB of base64; job ids are bounded; a job
  id that already printed is acknowledged as a duplicate, not reprinted.
- Discovery scans only the /24 of the tablet's own private LAN address,
  only when on Wi-Fi/Ethernet, with a hard timeout.

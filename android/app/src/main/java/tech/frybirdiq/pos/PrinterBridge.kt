package tech.frybirdiq.pos

import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.provider.Settings
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The printer bridge: the only native capability the web POS can reach.
 *
 * Every message is JSON `{ v: 1, id, op, payload }`. Eleven operations are
 * known; anything else is refused with INVALID_REQUEST. A printer address
 * is either a private IPv4 address with a sane port (Wi-Fi / LAN, TCP
 * 9100) or the Bluetooth address of a device the person picked on this
 * tablet (SPP); the payload for a print is base64 ESC/POS the bridge never
 * interprets, capped at 2 MB. A job id that already printed successfully
 * is not printed again — the reply says `duplicate: true` — so a retried
 * network call cannot produce two bills.
 *
 * No shell, no filesystem, no arbitrary sockets or devices: the only
 * sockets this class ever opens are a TCP connection to the validated LAN
 * address and an RFCOMM connection to the validated Bluetooth address.
 */
class PrinterBridge(private val context: Context, host: BluetoothPrinter.BridgeHost) {

    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val printer = EscPosTcpPrinter()
    private val discovery = PrinterDiscovery(context)
    private val bluetooth = BluetoothPrinter(context, host)

    @Volatile private var connection: PrinterAddress? = null
    @Volatile private var lastError: String? = null
    @Volatile private var lastStatus: StatusReport? = null

    /** Job ids that printed, most recent last. Bounded so a long shift cannot grow it without limit. */
    private val printedJobs = object : LinkedHashMap<String, Long>(64, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean = size > 500
    }

    /** Where a job goes: a LAN socket, or the selected Bluetooth device. */
    sealed class PrinterAddress {
        data class Lan(val host: String, val port: Int) : PrinterAddress()
        data class Bluetooth(val address: String, val name: String?) : PrinterAddress()
    }
    data class StatusReport(val status: String, val checkedAt: Long, val error: String?, val latencyMs: Long?)

    class BridgeException(val code: String, message: String) : Exception(message)

    fun handle(raw: String, reply: (String) -> Unit) {
        val request = try {
            JSONObject(raw)
        } catch (error: Exception) {
            return // Not our protocol. Nothing to reply to.
        }
        val id = request.optString("id", "")
        if (request.optInt("v", 0) != 1 || id.isEmpty() || id.length > 64) return
        val op = request.optString("op", "")
        val payload = request.optJSONObject("payload") ?: JSONObject()

        executor.execute {
            val response = JSONObject().put("v", 1).put("id", id)
            try {
                val result = dispatch(op, payload)
                response.put("ok", true).put("result", result)
            } catch (error: BridgeException) {
                lastError = error.message
                response.put("ok", false).put("error", JSONObject().put("code", error.code).put("message", error.message ?: error.code))
            } catch (error: Exception) {
                lastError = error.message ?: error.javaClass.simpleName
                response.put("ok", false).put("error", JSONObject().put("code", "BRIDGE_ERROR").put("message", lastError))
            }
            reply(response.toString())
        }
    }

    private fun dispatch(op: String, payload: JSONObject): JSONObject = when (op) {
        "CAPABILITIES" -> capabilities()
        "STATUS" -> status()
        "DISCOVER" -> discover(payload)
        "CONNECT" -> connect(payload)
        "DISCONNECT" -> { connection = null; lastStatus = null; bluetooth.disconnect(); JSONObject() }
        "BT_STATE" -> bluetoothState()
        "BT_ENABLE" -> { permissionAsked = true; bluetooth.enable(); bluetoothState() }
        "TEST_CONNECTION" -> testConnection(payload)
        "TEST_PRINT" -> print(payload, jobId = null)
        "PRINT_RECEIPT" -> print(payload, jobId = requireJobId(payload))
        "LAST_ERROR" -> JSONObject().put("error", lastError)
        else -> throw BridgeException("INVALID_REQUEST", "Unknown operation.")
    }

    /* ---- operations --------------------------------------------------- */

    private fun capabilities(): JSONObject {
        val pm = context.packageManager
        val tablet = context.resources.configuration.smallestScreenWidthDp >= 600 ||
            (context.resources.configuration.screenLayout and Configuration.SCREENLAYOUT_SIZE_MASK) >= Configuration.SCREENLAYOUT_SIZE_LARGE
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val lan = discovery.localAddress()
        return JSONObject()
            .put("deviceId", if (androidId.isNullOrBlank()) JSONObject.NULL else "android-$androidId")
            // The name the person gave the tablet ("Redmi Pad"), not the model code ("22081283G").
            .put("deviceName", deviceName())
            .put("platform", "ANDROID")
            // Running the FRYBIRD POS app makes this device the POS terminal, whatever its screen size.
            .put("deviceType", "POS_TERMINAL")
            .put("formFactor", if (tablet) "TABLET" else "PHONE")
            .put("model", Build.MODEL)
            .put("manufacturer", Build.MANUFACTURER?.replaceFirstChar { it.uppercase() })
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("bridgeVersion", BuildConfig.BRIDGE_VERSION)
            .put(
                "capabilities",
                JSONObject()
                    .put("printer", true)
                    .put("localPrinterBridge", true)
                    .put("wifi", pm.hasSystemFeature(PackageManager.FEATURE_WIFI))
                    .put("bluetooth", bluetooth.supported)
                    .put("usb", false),
            )
            .put("network", JSONObject().put("wifiConnected", lan != null).put("subnet", lan?.let { PrinterDiscovery.subnetOf(it) } ?: JSONObject.NULL))
    }

    /** Settings › About › Device name, else the Bluetooth name, else the model. */
    private fun deviceName(): String {
        val fromSettings = runCatching { Settings.Global.getString(context.contentResolver, "device_name") }.getOrNull()
        if (!fromSettings.isNullOrBlank()) return fromSettings.trim()
        val fromBluetooth = runCatching { bluetooth.adapterName() }.getOrNull()
        if (!fromBluetooth.isNullOrBlank()) return fromBluetooth.trim()
        return Build.MODEL ?: "Android device"
    }

    private fun status(): JSONObject {
        val target = connection ?: return JSONObject().put("status", "UNKNOWN").put("connection", JSONObject.NULL).put("checkedAt", JSONObject.NULL).put("error", JSONObject.NULL)
        if (target is PrinterAddress.Bluetooth) return bluetoothReport(target).toJson(target)
        val cached = lastStatus
        // Recent answers are reused: a status poll must never turn into hammering the printer.
        val report = if (cached != null && System.currentTimeMillis() - cached.checkedAt < STATUS_CACHE_MS) cached else probe(target)
        return report.toJson(target)
    }

    private fun bluetoothState(): JSONObject {
        val selected = bluetooth.selected
        return JSONObject()
            .put("supported", bluetooth.supported)
            .put("enabled", bluetooth.enabled)
            .put("permission", if (bluetooth.hasPermissions()) "granted" else if (permissionAsked) "denied" else "not_requested")
            .put("connected", bluetooth.connected)
            .put("selected", if (selected == null) JSONObject.NULL else JSONObject().put("address", selected.address).put("name", selected.name ?: JSONObject.NULL))
            .put("error", bluetooth.lastError ?: JSONObject.NULL)
    }

    /** The live socket state — no probe needed, the socket is either open or it is not. */
    private fun bluetoothReport(target: PrinterAddress.Bluetooth): StatusReport {
        val selected = bluetooth.selected
        val status = when {
            selected?.address == target.address && bluetooth.connected -> "ONLINE"
            selected?.address == target.address && bluetooth.isReconnecting -> "CONNECTING"
            !bluetooth.enabled -> "OFFLINE"
            else -> "OFFLINE"
        }
        val error = if (status == "ONLINE") null else bluetooth.lastError ?: if (!bluetooth.enabled) "Bluetooth is switched off on this device." else "Not connected to ${target.name ?: target.address}."
        return StatusReport(status, System.currentTimeMillis(), error, null)
    }

    private fun connect(payload: JSONObject): JSONObject {
        val target = requireAddress(payload)
        connection = target
        lastStatus = null
        if (target is PrinterAddress.Bluetooth) {
            permissionAsked = true
            return try {
                bluetooth.connect(target.address, target.name)
                bluetoothReport(target).toJson(target)
            } catch (error: BluetoothPrinter.BluetoothException) {
                lastError = error.message
                StatusReport("OFFLINE", System.currentTimeMillis(), error.message, null).toJson(target)
            }
        }
        return probe(target).toJson(target)
    }

    private fun testConnection(payload: JSONObject): JSONObject {
        val target = requireAddress(payload)
        if (target is PrinterAddress.Bluetooth) {
            permissionAsked = true
            return try {
                val started = System.nanoTime()
                bluetooth.connect(target.address, target.name)
                JSONObject().put("ok", true).put("latencyMs", (System.nanoTime() - started) / 1_000_000).put("error", JSONObject.NULL)
            } catch (error: BluetoothPrinter.BluetoothException) {
                JSONObject().put("ok", false).put("latencyMs", JSONObject.NULL).put("error", error.message)
            }
        }
        val report = probe(target)
        return JSONObject().put("ok", report.status == "ONLINE").put("latencyMs", report.latencyMs ?: JSONObject.NULL).put("error", report.error ?: JSONObject.NULL)
    }

    private fun discover(payload: JSONObject): JSONObject {
        val timeoutMs = payload.optLong("timeoutMs", 15_000L).coerceIn(2_000L, 30_000L)
        val printers = JSONArray()
        if (payload.optString("transport", "LAN") == "BLUETOOTH") {
            permissionAsked = true
            val found = try {
                bluetooth.scan(timeoutMs)
            } catch (error: BluetoothPrinter.BluetoothException) {
                throw BridgeException(error.code, error.message ?: "Bluetooth scan failed.")
            }
            for (device in found) printers.put(JSONObject().put("address", device.address).put("name", device.name ?: JSONObject.NULL).put("paired", device.paired))
            return JSONObject().put("printers", printers)
        }
        val port = payload.optInt("port", 9100)
        if (port !in 1..65535) throw BridgeException("INVALID_ADDRESS", "Port must be between 1 and 65535.")
        val found = discovery.scan(port, timeoutMs)
        for (hit in found) printers.put(JSONObject().put("host", hit.host).put("port", hit.port).put("hostname", hit.hostname ?: JSONObject.NULL).put("latencyMs", hit.latencyMs))
        return JSONObject().put("printers", printers)
    }

    private fun print(payload: JSONObject, jobId: String?): JSONObject {
        val target = requireAddress(payload)
        val data = requireData(payload)
        if (jobId != null) {
            synchronized(printedJobs) {
                if (printedJobs.containsKey(jobId)) return JSONObject().put("printed", true).put("duplicate", true).put("bytes", 0)
            }
        }
        try {
            when (target) {
                is PrinterAddress.Lan -> printer.send(target.host, target.port, data)
                is PrinterAddress.Bluetooth -> {
                    permissionAsked = true
                    if (connection == null) connection = target
                    bluetooth.send(target.address, target.name, data)
                }
            }
        } catch (error: EscPosTcpPrinter.PrintException) {
            lastStatus = StatusReport("OFFLINE", System.currentTimeMillis(), error.message, null)
            throw BridgeException(error.code, error.message ?: "Printing failed.")
        } catch (error: BluetoothPrinter.BluetoothException) {
            throw BridgeException(error.code, error.message ?: "Printing failed.")
        }
        if (jobId != null) synchronized(printedJobs) { printedJobs[jobId] = System.currentTimeMillis() }
        lastStatus = StatusReport("ONLINE", System.currentTimeMillis(), null, null)
        lastError = null
        return JSONObject().put("printed", true).put("duplicate", false).put("bytes", data.size)
    }

    /* ---- helpers ------------------------------------------------------ */

    private fun probe(target: PrinterAddress): StatusReport {
        if (target !is PrinterAddress.Lan) return bluetoothReport(target as PrinterAddress.Bluetooth)
        val report = try {
            val latency = printer.probe(target.host, target.port)
            StatusReport("ONLINE", System.currentTimeMillis(), null, latency)
        } catch (error: EscPosTcpPrinter.PrintException) {
            StatusReport("OFFLINE", System.currentTimeMillis(), error.message, null)
        }
        if (target == connection) lastStatus = report
        return report
    }

    private fun StatusReport.toJson(target: PrinterAddress): JSONObject = JSONObject()
        .put("status", status)
        .put(
            "connection",
            when (target) {
                is PrinterAddress.Lan -> JSONObject().put("host", target.host).put("port", target.port)
                is PrinterAddress.Bluetooth -> JSONObject().put("address", target.address).put("name", target.name ?: JSONObject.NULL)
            },
        )
        .put("checkedAt", java.time.Instant.ofEpochMilli(checkedAt).toString())
        .put("error", error ?: JSONObject.NULL)
        .put("latencyMs", latencyMs ?: JSONObject.NULL)

    private fun requireAddress(payload: JSONObject): PrinterAddress {
        if (payload.optString("transport", "LAN") == "BLUETOOTH") {
            val address = payload.optString("address", "").trim().uppercase()
            if (!MAC.matches(address)) throw BridgeException("INVALID_ADDRESS", "That is not a Bluetooth address.")
            val name = payload.optString("name", "").takeIf { it.isNotBlank() }
            return PrinterAddress.Bluetooth(address, name)
        }
        val host = payload.optString("host", "").trim()
        val port = payload.optInt("port", 9100)
        if (!isPrivateIPv4(host)) throw BridgeException("INVALID_ADDRESS", "A printer must be on the shop's own network.")
        if (port !in 1..65535) throw BridgeException("INVALID_ADDRESS", "Port must be between 1 and 65535.")
        return PrinterAddress.Lan(host, port)
    }

    private fun requireJobId(payload: JSONObject): String {
        val jobId = payload.optString("jobId", "")
        if (jobId.isEmpty() || jobId.length > 100) throw BridgeException("INVALID_REQUEST", "A print job needs an id.")
        return jobId
    }

    private fun requireData(payload: JSONObject): ByteArray {
        val encoded = payload.optString("data", "")
        if (encoded.isEmpty() || encoded.length > MAX_DATA_BASE64) throw BridgeException("INVALID_REQUEST", "Nothing to print, or too much.")
        return try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            throw BridgeException("INVALID_REQUEST", "Print data is not base64.")
        }
    }

    fun shutdown() {
        bluetooth.disconnect()
        executor.shutdownNow()
    }

    @Volatile private var permissionAsked = false

    companion object {
        private const val STATUS_CACHE_MS = 10_000L
        /** 2 MB of ESC/POS is a very long receipt with a large logo. */
        private const val MAX_DATA_BASE64 = 2 * 1024 * 1024 * 4 / 3

        private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")
        private val MAC = Regex("^([0-9A-F]{2})(:[0-9A-F]{2}){5}$")

        /** RFC 1918 and link-local only — the same rule the web app and the server apply. */
        fun isPrivateIPv4(value: String): Boolean {
            val match = IPV4.matchEntire(value) ?: return false
            val parts = match.groupValues.drop(1).map { it.toIntOrNull() ?: return false }
            if (parts.any { it !in 0..255 }) return false
            val (a, b) = parts
            return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
        }
    }
}

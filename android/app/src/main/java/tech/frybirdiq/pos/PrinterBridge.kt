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
 * Every message is JSON `{ v: 1, id, op, payload }`. Nine operations are
 * known; anything else is refused with INVALID_REQUEST. A printer address
 * must be a private IPv4 address and a sane port; the payload for a print
 * is base64 ESC/POS the bridge never interprets, capped at 2 MB. A job id
 * that already printed successfully is not printed again — the reply says
 * `duplicate: true` — so a retried network call cannot produce two bills.
 *
 * No shell, no filesystem, no Bluetooth, no arbitrary sockets: the only
 * socket this class ever opens is a TCP connection to the validated
 * printer address.
 */
class PrinterBridge(private val context: Context) {

    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val printer = EscPosTcpPrinter()
    private val discovery = PrinterDiscovery(context)

    @Volatile private var connection: PrinterAddress? = null
    @Volatile private var lastError: String? = null
    @Volatile private var lastStatus: StatusReport? = null

    /** Job ids that printed, most recent last. Bounded so a long shift cannot grow it without limit. */
    private val printedJobs = object : LinkedHashMap<String, Long>(64, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean = size > 500
    }

    data class PrinterAddress(val host: String, val port: Int)
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
        "DISCONNECT" -> { connection = null; lastStatus = null; JSONObject() }
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
            .put("deviceName", Build.MODEL ?: "Android device")
            .put("platform", "ANDROID")
            .put("deviceType", if (tablet) "TABLET" else "PHONE")
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
                    .put("bluetooth", pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH))
                    .put("usb", false),
            )
            .put("network", JSONObject().put("wifiConnected", lan != null).put("subnet", lan?.let { PrinterDiscovery.subnetOf(it) } ?: JSONObject.NULL))
    }

    private fun status(): JSONObject {
        val target = connection ?: return JSONObject().put("status", "UNKNOWN").put("connection", JSONObject.NULL).put("checkedAt", JSONObject.NULL).put("error", JSONObject.NULL)
        val cached = lastStatus
        // Recent answers are reused: a status poll must never turn into hammering the printer.
        val report = if (cached != null && System.currentTimeMillis() - cached.checkedAt < STATUS_CACHE_MS) cached else probe(target)
        return report.toJson(target)
    }

    private fun connect(payload: JSONObject): JSONObject {
        val target = requireAddress(payload)
        connection = target
        lastStatus = null
        return probe(target).toJson(target)
    }

    private fun testConnection(payload: JSONObject): JSONObject {
        val target = requireAddress(payload)
        val report = probe(target)
        return JSONObject().put("ok", report.status == "ONLINE").put("latencyMs", report.latencyMs ?: JSONObject.NULL).put("error", report.error ?: JSONObject.NULL)
    }

    private fun discover(payload: JSONObject): JSONObject {
        val timeoutMs = payload.optLong("timeoutMs", 15_000L).coerceIn(2_000L, 30_000L)
        val port = payload.optInt("port", 9100)
        if (port !in 1..65535) throw BridgeException("INVALID_ADDRESS", "Port must be between 1 and 65535.")
        val found = discovery.scan(port, timeoutMs)
        val printers = JSONArray()
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
            printer.send(target.host, target.port, data)
        } catch (error: EscPosTcpPrinter.PrintException) {
            lastStatus = StatusReport("OFFLINE", System.currentTimeMillis(), error.message, null)
            throw BridgeException(error.code, error.message ?: "Printing failed.")
        }
        if (jobId != null) synchronized(printedJobs) { printedJobs[jobId] = System.currentTimeMillis() }
        lastStatus = StatusReport("ONLINE", System.currentTimeMillis(), null, null)
        lastError = null
        return JSONObject().put("printed", true).put("duplicate", false).put("bytes", data.size)
    }

    /* ---- helpers ------------------------------------------------------ */

    private fun probe(target: PrinterAddress): StatusReport {
        val report = try {
            val latency = printer.probe(target.host, target.port)
            StatusReport("ONLINE", System.currentTimeMillis(), null, latency)
        } catch (error: EscPosTcpPrinter.PrintException) {
            StatusReport(if (error.code == "PRINTER_TIMEOUT") "OFFLINE" else "OFFLINE", System.currentTimeMillis(), error.message, null)
        }
        if (target == connection) lastStatus = report
        return report
    }

    private fun StatusReport.toJson(target: PrinterAddress): JSONObject = JSONObject()
        .put("status", status)
        .put("connection", JSONObject().put("host", target.host).put("port", target.port))
        .put("checkedAt", java.time.Instant.ofEpochMilli(checkedAt).toString())
        .put("error", error ?: JSONObject.NULL)
        .put("latencyMs", latencyMs ?: JSONObject.NULL)

    private fun requireAddress(payload: JSONObject): PrinterAddress {
        val host = payload.optString("host", "").trim()
        val port = payload.optInt("port", 9100)
        if (!isPrivateIPv4(host)) throw BridgeException("INVALID_ADDRESS", "A printer must be on the shop's own network.")
        if (port !in 1..65535) throw BridgeException("INVALID_ADDRESS", "Port must be between 1 and 65535.")
        return PrinterAddress(host, port)
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
        executor.shutdownNow()
    }

    companion object {
        private const val STATUS_CACHE_MS = 10_000L
        /** 2 MB of ESC/POS is a very long receipt with a large logo. */
        private const val MAX_DATA_BASE64 = 2 * 1024 * 1024 * 4 / 3

        private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")

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

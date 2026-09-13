package tech.frybirdiq.pos

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * Finds printers on the tablet's own Wi-Fi: the /24 the tablet is on, one
 * quick TCP connect to port 9100 per address. Runs on the device, on its
 * LAN, and nowhere else — the cloud never scans a restaurant's network,
 * and this never scans anything but the private subnet the tablet itself
 * belongs to.
 *
 * The POSIFLOW does not announce itself, so a hit is "something answers on
 * 9100"; the owner confirms it with a test print.
 */
class PrinterDiscovery(private val context: Context) {

    data class Hit(val host: String, val port: Int, val hostname: String?, val latencyMs: Long)

    /** The tablet's IPv4 address on the active Wi-Fi, or null when it is not on Wi-Fi. */
    fun localAddress(): Inet4Address? {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        val network = manager.activeNetwork ?: return null
        val capabilities = manager.getNetworkCapabilities(network) ?: return null
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return null
        val properties = manager.getLinkProperties(network) ?: return null
        return properties.linkAddresses.mapNotNull { it.address as? Inet4Address }.firstOrNull { PrinterBridge.isPrivateIPv4(it.hostAddress ?: "") }
    }

    fun scan(port: Int, timeoutMs: Long): List<Hit> {
        val self = localAddress() ?: throw PrinterBridge.BridgeException("NOT_ON_WIFI", "Connect the tablet to the restaurant Wi-Fi first.")
        val prefix = subnetOf(self)
        val ownHost = self.hostAddress
        val pool = Executors.newFixedThreadPool(CONCURRENCY)
        val deadline = System.currentTimeMillis() + timeoutMs
        val futures = ArrayList<Future<Hit?>>(254)
        try {
            for (last in 1..254) {
                val host = "$prefix.$last"
                if (host == ownHost) continue
                futures.add(pool.submit(Callable {
                    if (System.currentTimeMillis() > deadline) return@Callable null
                    val started = System.nanoTime()
                    try {
                        Socket().use { it.connect(InetSocketAddress(host, port), PER_HOST_TIMEOUT_MS) }
                    } catch (error: Exception) {
                        return@Callable null
                    }
                    val latency = (System.nanoTime() - started) / 1_000_000
                    val hostname = runCatching { InetAddress.getByName(host).canonicalHostName }.getOrNull()?.takeIf { it != host }
                    Hit(host, port, hostname, latency)
                }))
            }
            val hits = ArrayList<Hit>()
            for (future in futures) {
                val remaining = deadline - System.currentTimeMillis()
                val hit = try {
                    future.get(maxOf(remaining, 1L), TimeUnit.MILLISECONDS)
                } catch (error: Exception) {
                    null
                }
                if (hit != null) hits.add(hit)
            }
            return hits.sortedBy { it.latencyMs }
        } finally {
            pool.shutdownNow()
        }
    }

    companion object {
        private const val CONCURRENCY = 32
        private const val PER_HOST_TIMEOUT_MS = 400

        /** "192.168.1.37" → "192.168.1". */
        fun subnetOf(address: Inet4Address): String = (address.hostAddress ?: "").substringBeforeLast('.')
    }
}

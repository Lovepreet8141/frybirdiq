package tech.frybirdiq.pos

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Raw ESC/POS over TCP — port 9100 on the printer. Connect, write the
 * bytes, flush, close. That is the whole protocol; the printer does the
 * rest.
 *
 * A send retries a few times with backoff for the case where the printer
 * is waking up or the Wi-Fi just came back, and gives up with a clear
 * code rather than hanging the till.
 */
class EscPosTcpPrinter {

    class PrintException(val code: String, message: String) : IOException(message)

    /** TCP connect only. How long it took, or why it did not. */
    fun probe(host: String, port: Int, timeoutMs: Int = PROBE_TIMEOUT_MS): Long {
        val started = System.nanoTime()
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), timeoutMs)
            }
        } catch (error: SocketTimeoutException) {
            throw PrintException("PRINTER_TIMEOUT", "$host:$port did not answer within ${timeoutMs / 1000} s.")
        } catch (error: IOException) {
            throw PrintException("PRINTER_UNREACHABLE", "$host:$port refused the connection: ${error.message ?: "unreachable"}.")
        }
        return (System.nanoTime() - started) / 1_000_000
    }

    /** Write the bytes, retrying with backoff. Throws with a code when every attempt fails. */
    fun send(host: String, port: Int, data: ByteArray, attempts: Int = ATTEMPTS) {
        var last: PrintException? = null
        for (attempt in 1..attempts) {
            try {
                write(host, port, data)
                return
            } catch (error: PrintException) {
                last = error
                if (attempt < attempts) Thread.sleep(BACKOFF_MS[minOf(attempt - 1, BACKOFF_MS.size - 1)])
            }
        }
        throw last ?: PrintException("PRINTER_UNREACHABLE", "Printing failed.")
    }

    private fun write(host: String, port: Int, data: ByteArray) {
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
                socket.soTimeout = WRITE_TIMEOUT_MS
                socket.tcpNoDelay = true
                val out = socket.getOutputStream()
                var offset = 0
                while (offset < data.size) {
                    val length = minOf(CHUNK, data.size - offset)
                    out.write(data, offset, length)
                    offset += length
                }
                out.flush()
                // Give the printer's buffer a moment before the socket closes under it.
                Thread.sleep(SETTLE_MS)
            }
        } catch (error: SocketTimeoutException) {
            throw PrintException("PRINTER_TIMEOUT", "$host:$port stopped answering while printing.")
        } catch (error: IOException) {
            throw PrintException("PRINTER_UNREACHABLE", "Could not reach $host:$port: ${error.message ?: "unreachable"}.")
        }
    }

    companion object {
        const val PROBE_TIMEOUT_MS = 2_000
        const val CONNECT_TIMEOUT_MS = 4_000
        const val WRITE_TIMEOUT_MS = 10_000
        const val ATTEMPTS = 3
        const val CHUNK = 4096
        const val SETTLE_MS = 150L
        val BACKOFF_MS = longArrayOf(500L, 1_500L, 3_000L)
    }
}

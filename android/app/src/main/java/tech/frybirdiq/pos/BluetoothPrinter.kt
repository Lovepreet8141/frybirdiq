package tech.frybirdiq.pos

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * ESC/POS over Bluetooth Classic (SPP / RFCOMM) — the POSIFLOW KP307-UEWB
 * as a serial port. One socket, kept open, written to on every job; a
 * background loop reconnects with backoff whenever the printer goes away
 * and comes back.
 *
 * Nothing here is faked: `scan()` reports what the radio actually sees,
 * `connect()` returns only after the socket is open, and `send()` throws
 * with a code when the bytes could not be written.
 */
class BluetoothPrinter(private val context: Context, private val host: BridgeHost) {

    /** What the bridge needs from the Activity: runtime permissions and the "turn on Bluetooth" dialog. */
    interface BridgeHost {
        fun requestPermissions(permissions: Array<String>): Boolean
        fun requestEnableBluetooth(): Boolean
    }

    data class Device(val address: String, val name: String?, val paired: Boolean)
    data class Selected(val address: String, val name: String?)

    class BluetoothException(val code: String, message: String) : IOException(message)

    private val adapter: BluetoothAdapter? = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    @Volatile var selected: Selected? = null
        private set
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var output: OutputStream? = null
    @Volatile var lastError: String? = null
        private set
    @Volatile private var reconnecting = false
    private var reconnectThread: Thread? = null
    private val lock = Any()

    /* ---- state -------------------------------------------------------- */

    val supported: Boolean get() = adapter != null && context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH)
    val enabled: Boolean get() = adapter?.isEnabled == true
    val connected: Boolean get() = socket?.isConnected == true && output != null
    val isReconnecting: Boolean get() = reconnecting

    /** The permissions this Android version needs for scanning and connecting. */
    fun requiredPermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN, Manifest.permission.ACCESS_FINE_LOCATION)

    fun hasPermissions(): Boolean = requiredPermissions().all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    /** Permissions and radio, or a clear exception saying which one is missing. */
    private fun ensureReady() {
        if (!supported) throw BluetoothException("BLUETOOTH_UNAVAILABLE", "This device has no Bluetooth.")
        if (!hasPermissions() && !host.requestPermissions(requiredPermissions())) {
            throw BluetoothException("PERMISSION_DENIED", "Bluetooth permission was denied. Allow \"Nearby devices\" for FRYBIRD POS in Android Settings.")
        }
        if (!enabled && !host.requestEnableBluetooth()) throw BluetoothException("BLUETOOTH_DISABLED", "Bluetooth is switched off on this device.")
        if (!enabled) throw BluetoothException("BLUETOOTH_DISABLED", "Bluetooth is switched off on this device.")
    }

    /* ---- discovery ---------------------------------------------------- */

    /** Paired devices first, then whatever answers a classic discovery within the timeout. */
    @SuppressLint("MissingPermission") // ensureReady() checked and requested them.
    fun scan(timeoutMs: Long): List<Device> {
        ensureReady()
        val adapter = this.adapter ?: throw BluetoothException("BLUETOOTH_UNAVAILABLE", "This device has no Bluetooth.")
        val found = LinkedHashMap<String, Device>()
        for (device in adapter.bondedDevices ?: emptySet()) found[device.address] = Device(device.address, device.name, paired = true)

        val done = CountDownLatch(1)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    BluetoothDevice.ACTION_FOUND -> {
                        val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                        if (device != null && !found.containsKey(device.address)) found[device.address] = Device(device.address, device.name, paired = device.bondState == BluetoothDevice.BOND_BONDED)
                    }
                    BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> done.countDown()
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_FOUND)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        }
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        try {
            if (adapter.isDiscovering) adapter.cancelDiscovery()
            if (adapter.startDiscovery()) done.await(timeoutMs.coerceIn(3_000L, 30_000L), TimeUnit.MILLISECONDS)
        } finally {
            runCatching { adapter.cancelDiscovery() }
            runCatching { context.unregisterReceiver(receiver) }
        }
        return found.values.sortedWith(compareByDescending<Device> { it.paired }.thenBy { it.name ?: "￿" })
    }

    /* ---- connection --------------------------------------------------- */

    /** Select and connect. Pairs first if the device is not bonded (Android shows the PIN dialog). */
    fun connect(address: String, name: String?): Selected {
        ensureReady()
        synchronized(lock) {
            val current = selected
            if (current != null && current.address == address && connected) return current
            closeSocket()
            selected = Selected(address, name)
            open(address)
        }
        startAutoReconnect()
        return selected!!
    }

    @SuppressLint("MissingPermission")
    private fun open(address: String) {
        val adapter = this.adapter ?: throw BluetoothException("BLUETOOTH_UNAVAILABLE", "This device has no Bluetooth.")
        val device = try {
            adapter.getRemoteDevice(address)
        } catch (error: IllegalArgumentException) {
            throw BluetoothException("INVALID_ADDRESS", "That is not a Bluetooth address.")
        }
        if (adapter.isDiscovering) adapter.cancelDiscovery()
        if (device.bondState != BluetoothDevice.BOND_BONDED) pair(device)

        var lastFailure: IOException? = null
        for (attempt in 1..2) {
            val candidate = try {
                if (attempt == 1) device.createRfcommSocketToServiceRecord(SPP_UUID) else device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
            } catch (error: IOException) {
                lastFailure = error
                continue
            }
            try {
                candidate.connect()
                socket = candidate
                output = candidate.outputStream
                lastError = null
                return
            } catch (error: IOException) {
                lastFailure = error
                runCatching { candidate.close() }
            }
        }
        val message = lastFailure?.message ?: "connection failed"
        lastError = message
        throw BluetoothException(
            if (message.contains("timeout", ignoreCase = true)) "PRINTER_TIMEOUT" else "PRINTER_UNREACHABLE",
            "Could not connect to ${selected?.name ?: address}: $message. Is the printer on and in range?",
        )
    }

    /** Ask Android to bond; the system shows the PIN prompt (POSIFLOW printers usually use 0000 or 1234). */
    @SuppressLint("MissingPermission")
    private fun pair(device: BluetoothDevice) {
        if (!device.createBond()) throw BluetoothException("PAIRING_FAILED", "Android could not start pairing with ${device.name ?: device.address}.")
        val deadline = System.currentTimeMillis() + PAIR_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            when (device.bondState) {
                BluetoothDevice.BOND_BONDED -> return
                BluetoothDevice.BOND_NONE -> if (System.currentTimeMillis() > deadline - PAIR_TIMEOUT_MS + 3_000L) throw BluetoothException("PAIRING_FAILED", "Pairing with ${device.name ?: device.address} was cancelled or refused.")
            }
            Thread.sleep(500L)
        }
        throw BluetoothException("PAIRING_FAILED", "Pairing with ${device.name ?: device.address} timed out. Confirm the PIN on the tablet and try again.")
    }

    fun disconnect() {
        synchronized(lock) {
            selected = null
            closeSocket()
        }
        reconnectThread?.interrupt()
        reconnectThread = null
        reconnecting = false
    }

    private fun closeSocket() {
        runCatching { output?.close() }
        runCatching { socket?.close() }
        output = null
        socket = null
    }

    /**
     * Keeps the selected printer connected: when the socket drops (power
     * off, out of range) it retries with backoff from 2 s to 30 s — never
     * hammering — and a NUL keep-alive every 20 s notices a silent drop.
     */
    private fun startAutoReconnect() {
        if (reconnectThread?.isAlive == true) return
        reconnectThread = Thread {
            var backoffMs = 2_000L
            try {
                while (!Thread.currentThread().isInterrupted) {
                    val target = selected ?: break
                    if (connected) {
                        Thread.sleep(KEEPALIVE_MS)
                        try {
                            synchronized(lock) { output?.write(0x00); output?.flush() }
                        } catch (error: IOException) {
                            lastError = "Connection to ${target.name ?: target.address} was lost."
                            synchronized(lock) { closeSocket() }
                        }
                        backoffMs = 2_000L
                        continue
                    }
                    reconnecting = true
                    try {
                        synchronized(lock) { if (selected != null && !connected) open(target.address) }
                        reconnecting = false
                        backoffMs = 2_000L
                    } catch (error: IOException) {
                        lastError = error.message
                        Thread.sleep(backoffMs)
                        backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
                    }
                }
            } catch (interrupted: InterruptedException) {
                // disconnect() asked us to stop.
            } finally {
                reconnecting = false
            }
        }.apply {
            isDaemon = true
            name = "frypos-bt-reconnect"
            start()
        }
    }

    /* ---- printing ----------------------------------------------------- */

    /** Write the bytes over the open socket, connecting first if needed. Throws with a code on failure. */
    fun send(address: String, name: String?, data: ByteArray) {
        ensureReady()
        synchronized(lock) {
            if (selected?.address != address || !connected) {
                closeSocket()
                selected = Selected(address, name ?: selected?.name)
                open(address)
            }
            val stream = output ?: throw BluetoothException("PRINTER_DISCONNECTED", "The printer is not connected.")
            try {
                var offset = 0
                while (offset < data.size) {
                    val length = minOf(CHUNK, data.size - offset)
                    stream.write(data, offset, length)
                    offset += length
                }
                stream.flush()
                Thread.sleep(SETTLE_MS)
            } catch (error: IOException) {
                lastError = error.message
                closeSocket()
                throw BluetoothException("PRINTER_DISCONNECTED", "Writing to ${name ?: address} failed: ${error.message ?: "connection lost"}. The bridge will reconnect.")
            }
        }
        startAutoReconnect()
    }

    companion object {
        /** Serial Port Profile — what an ESC/POS Bluetooth printer speaks. */
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        private const val CHUNK = 512
        private const val SETTLE_MS = 100L
        private const val KEEPALIVE_MS = 20_000L
        private const val PAIR_TIMEOUT_MS = 60_000L
    }
}

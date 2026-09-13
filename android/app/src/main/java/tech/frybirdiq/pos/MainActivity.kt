package tech.frybirdiq.pos

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.bluetooth.BluetoothAdapter
import android.app.Activity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * FRYBIRD POS: the web POS at https://frybirdiq.tech/app/pos inside a
 * WebView, plus the local printer bridge.
 *
 * The bridge is exposed through WebViewCompat.addWebMessageListener,
 * restricted to the FRYBIRD origin. A page from any other origin — even
 * one this WebView is navigated to — never sees `FRYPOS_NATIVE`. Nothing
 * is exposed with addJavascriptInterface.
 */
class MainActivity : AppCompatActivity(), BluetoothPrinter.BridgeHost {

    private lateinit var webView: WebView
    private lateinit var offline: LinearLayout
    private lateinit var bridge: PrinterBridge

    // Bluetooth needs two things only the Activity can do: ask for runtime
    // permissions and show the "turn on Bluetooth" dialog. The bridge calls
    // these from its worker thread and waits for the person's answer.
    private var permissionLatch: CountDownLatch? = null
    private val permissionResult = AtomicBoolean(false)
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        permissionResult.set(granted.values.all { it })
        permissionLatch?.countDown()
    }
    private var enableLatch: CountDownLatch? = null
    private val enableResult = AtomicBoolean(false)
    private val enableLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        enableResult.set(result.resultCode == Activity.RESULT_OK)
        enableLatch?.countDown()
    }

    override fun requestPermissions(permissions: Array<String>): Boolean {
        val latch = CountDownLatch(1)
        permissionLatch = latch
        permissionResult.set(false)
        runOnUiThread { permissionLauncher.launch(permissions) }
        latch.await(2, TimeUnit.MINUTES)
        return permissionResult.get()
    }

    override fun requestEnableBluetooth(): Boolean {
        val latch = CountDownLatch(1)
        enableLatch = latch
        enableResult.set(false)
        runOnUiThread { enableLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)) }
        latch.await(2, TimeUnit.MINUTES)
        return enableResult.get()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        // A till stays on.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = findViewById(R.id.webview)
        offline = findViewById(R.id.offline)
        findViewById<Button>(R.id.retry).setOnClickListener { load() }

        bridge = PrinterBridge(applicationContext, this)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            // Tells the web app which shell it is in; the bridge itself is what it feature-detects.
            userAgentString = "$userAgentString FRYBIRD-POS/${BuildConfig.VERSION_NAME}"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                // The app stays on its own origin. Anything else (a payment page, a map link) opens in the system browser.
                if (isPosOrigin(url)) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showOffline(true)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (url != null && isPosOrigin(Uri.parse(url))) showOffline(false)
            }
        }

        installBridge()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
            }
        })

        if (savedInstanceState == null) load() else webView.restoreState(savedInstanceState)
    }

    /**
     * `FRYPOS_NATIVE` for the FRYBIRD origin only. The listener checks the
     * source origin and the main frame again on every message — belt and
     * braces — and hands the JSON to the bridge, which allows nine
     * operations and nothing else.
     */
    private fun installBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // An old WebView without message listeners: the app still runs the POS; printing stays browser-only.
            return
        }
        val allowed = setOf(BuildConfig.POS_ORIGIN)
        WebViewCompat.addWebMessageListener(webView, "FRYPOS_NATIVE", allowed) { _, message, sourceOrigin, isMainFrame, replyProxy ->
            if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != BuildConfig.POS_ORIGIN) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            bridge.handle(data) { reply -> runOnUiThread { replyProxy.postMessage(reply) } }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // A marker the page can read before its own scripts run. The provider itself is built by the web app over FRYPOS_NATIVE.
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                "window.FRYPOS = Object.assign(window.FRYPOS || {}, { bridgeVersion: \"${BuildConfig.BRIDGE_VERSION}\", app: \"android\" });",
                allowed,
            )
        }
    }

    private fun load() {
        showOffline(false)
        webView.loadUrl(BuildConfig.POS_ORIGIN + BuildConfig.POS_PATH)
    }

    private fun showOffline(show: Boolean) {
        offline.visibility = if (show) View.VISIBLE else View.GONE
        webView.visibility = if (show) View.INVISIBLE else View.VISIBLE
    }

    private fun isPosOrigin(url: Uri): Boolean {
        val origin = Uri.parse(BuildConfig.POS_ORIGIN)
        return url.scheme == origin.scheme && url.host.equals(origin.host, ignoreCase = true)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        bridge.shutdown()
        webView.destroy()
        super.onDestroy()
    }
}

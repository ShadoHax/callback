package app.callback.bridge

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

// Attach to the official CameraAccess ViewModel's active stream. Start only while
// the wearer has enabled discovery and the camera session is streaming.
class CallbackAutoScan(
    private val scope: CoroutineScope,
    private val client: CallbackScanTransport,
    private val captureJpeg: suspend () -> ByteArray?,
    private val onConnection: (JSONObject) -> Unit,
    private val onError: (String) -> Unit,
    private val intervalMillis: Long = 20_000,
) {
    private var job: Job? = null
    private var lastConnection = ""

    fun start() {
        if (job?.isActive == true) return
        lastConnection = ""
        job = scope.launch {
            while (isActive) {
                try {
                    val jpeg = captureJpeg()
                    if (jpeg != null && jpeg.isNotEmpty()) {
                        val response = withContext(Dispatchers.IO) { client.scanPhoto(jpeg) }
                        if (!isActive) break
                        val error = response.events.firstOrNull { it.optString("type") == "error" }
                        if (error != null) onError(error.optString("message", "Scan failed."))
                        else if (response.status !in 200..299) onError("Scan failed (${response.status}).")
                        else {
                            val result = response.events.firstOrNull { it.optString("type") == "result" }?.optJSONObject("result")
                            if (result?.optString("status") == "matched") {
                                val key = listOf(result.optString("person"), result.optString("observedEntity"), result.optString("relation")).joinToString("|")
                                if (key != lastConnection) { lastConnection = key; onConnection(result) }
                            }
                        }
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { onError(failure.message ?: "Scan failed.") }
                delay(intervalMillis)
            }
        }
    }

    fun stop() { job?.cancel(); job = null }
}
